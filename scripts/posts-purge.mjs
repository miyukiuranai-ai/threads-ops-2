#!/usr/bin/env node
// 名義の「投稿済み」の投稿を、Threads からまとめて削除する（threads-ops2 で追加）。
//
// ★ 消したものは元に戻せません。いいね・コメント・表示数も一緒に消えます。
// ★ 既定では何も消しません。件数を出すだけです。実際に消すときだけ --yes を付けてください。
// ★ 下書き（承認待ち・承認済み・保留）は消しません。投稿済みだけが対象です。
//
// 使い方:
//   npm run posts:purge -- --accounts nara.ruriko,minamo.777              # 件数を数えるだけ
//   npm run posts:purge -- --accounts nara.ruriko,minamo.777 --yes        # 実際に削除する
//   npm run posts:purge -- --accounts nara.ruriko --from 2026-09-01 --to 2026-09-20 --yes
//   npm run posts:purge -- --accounts nara.ruriko --limit 10 --yes        # 古いものから10件だけ
import { loadEnv } from './lib/env.mjs';
import { getDb, COLLECTIONS } from '../lib/server/firebase.mjs';
import { deletePostedPost } from '../lib/server/post-delete.mjs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Threads の API を続けて叩きすぎないよう、1件ごとに少し待つ
const WAIT_MS = 250;

function parseArgs(argv) {
  const args = { accounts: null, from: null, to: null, limit: null, yes: false };
  const list = (v) => String(v ?? '').split(/[,\s、]+/).map((s) => s.trim().replace(/^@/, '')).filter(Boolean);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--accounts' || a === '--account') args.accounts = list(argv[++i]);
    else if (a === '--from') args.from = String(argv[++i] ?? '').trim();
    else if (a === '--to') args.to = String(argv[++i] ?? '').trim();
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--yes') args.yes = true;
    else if (a === '--dry') args.yes = false;
    else throw new Error(`知らない指定です: ${a}`);
  }
  if (!args.accounts?.length) throw new Error('--accounts 名義1,名義2 を指定してください。');
  for (const [k, v] of [['--from', args.from], ['--to', args.to]]) {
    if (v && !DATE_RE.test(v)) throw new Error(`${k} は YYYY-MM-DD で指定してください: ${v}`);
  }
  if (args.limit != null && (!Number.isInteger(args.limit) || args.limit < 1)) {
    throw new Error('--limit は1以上の整数で指定してください。');
  }
  return args;
}

/** 日本時間の日付（YYYY-MM-DD）にする。 */
const jstDate = (iso) => new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 「設定が足りない」せいの失敗かどうかを見分ける。
 * これは1件だけの問題ではなく全部に同じことが起きるので、続けても意味がない。
 * 例: Meta アプリに threads_delete の権限が付いていない（code=10）、トークンが切れている。
 */
function isSetupProblem(message) {
  const m = String(message ?? '');
  return /code=10\b/.test(m)
    || /does not have permission/i.test(m)
    || /subcode=33\b/.test(m)
    || /threads_delete/i.test(m)
    || /OAuth|access token|Session has expired/i.test(m);
}

const SETUP_HELP = [
  '',
  '★ これは投稿ごとの問題ではなく、設定が足りていません。続けても全部同じ失敗になるので止めました。',
  '  いちばん多い原因は、Meta のアプリに「投稿の削除（threads_delete）」の権限が付いていないことです。',
  '',
  '  直し方:',
  '   1. Meta for Developers でアプリを開く',
  '   2. Threads のユースケースの「アクセス許可」に threads_delete を足す',
  '   3. 7名義ぶんのトークンを取り直す（npm run auth:url → auth:exchange → token:import）',
  '      ※ 権限を足しただけでは、いま入っているトークンには反映されません。取り直しが要ります',
  '   4. もう一度この命令を実行する',
  '',
  '  何も削除していません。投稿はすべて残っています。',
].join('\n');

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const db = getDb();

  const all = (await db.collection(COLLECTIONS.accounts).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const targets = [];
  const missing = [];
  for (const wanted of args.accounts) {
    const hit = all.find((a) => a.name === wanted || String(a.name ?? '').toLowerCase() === wanted.toLowerCase());
    if (hit) targets.push(hit);
    else missing.push(wanted);
  }
  // 1つでも名義を間違えていたら、何もせずに止める
  if (missing.length) throw new Error(`名義が見つかりません: ${missing.join(', ')}`);

  // 対象を集める（投稿済みで、Threads 側の ID があるものだけ）
  const perAccount = [];
  for (const acc of targets) {
    const snap = await db.collection(COLLECTIONS.posts).where('accountId', '==', acc.id).get();
    let rows = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => p.status === 'posted' && p.postedThreadId)
      .map((p) => ({ ...p, day: p.plannedDate ?? jstDate(p.scheduledAt ?? p.postedAt ?? Date.now()) }))
      .sort((a, b) => String(a.scheduledAt ?? '').localeCompare(String(b.scheduledAt ?? '')));
    if (args.from) rows = rows.filter((p) => p.day >= args.from);
    if (args.to) rows = rows.filter((p) => p.day <= args.to);
    if (args.limit) rows = rows.slice(0, args.limit);
    perAccount.push({ acc, rows, hasToken: Boolean(acc.accessToken) });
  }

  const total = perAccount.reduce((n, x) => n + x.rows.length, 0);

  console.log('削除の対象（投稿済みのみ。下書きは対象外）');
  if (args.from || args.to) console.log(`  期間: ${args.from ?? '最初'} 〜 ${args.to ?? '最後'}`);
  if (args.limit) console.log(`  1名義あたり古いものから ${args.limit}件まで`);
  console.log('');
  for (const { acc, rows, hasToken } of perAccount) {
    const span = rows.length ? `${rows[0].day} 〜 ${rows[rows.length - 1].day}` : '-';
    console.log(`  @${acc.name.padEnd(18)} ${String(rows.length).padStart(4)}件  ${span}${hasToken ? '' : '  ※トークンがありません'}`);
  }
  console.log(`  合計 ${total}件`);
  console.log('');

  if (!total) { console.log('消すものがありません。'); return; }

  if (!args.yes) {
    console.log('★ まだ何も消していません。');
    console.log('  実際に削除するときは、同じ命令の最後に --yes を付けて実行してください。');
    console.log('  消したものは Threads から本当に消え、元に戻せません（いいね・コメント・表示数も消えます）。');
    return;
  }

  const noToken = perAccount.filter((x) => x.rows.length && !x.hasToken);
  if (noToken.length) {
    throw new Error(`トークンが無い名義があります: ${noToken.map((x) => `@${x.acc.name}`).join(', ')}。先にトークンを入れ直してください。`);
  }

  console.log(`削除を始めます（${total}件）。途中で止めたいときは Ctrl+C を押してください。`);
  console.log('');

  let ok = 0;
  const failed = [];
  for (const { acc, rows } of perAccount) {
    for (const [i, post] of rows.entries()) {
      const head = String(post.body ?? '').split('\n')[0].slice(0, 24);
      try {
        await deletePostedPost({ postId: post.id, by: `posts:purge（${process.env.OPS_USER ?? 'suzuki'}）` });
        ok += 1;
        console.log(`  削除 ${String(ok).padStart(4)}/${total}  @${acc.name} ${post.day} ${head}`);
      } catch (err) {
        // 設定が足りない失敗は、続けても全部同じになるのですぐ止める
        if (isSetupProblem(err.message)) {
          console.log(`  失敗 @${acc.name} ${post.day} ${head} … ${err.message}`);
          console.log(SETUP_HELP);
          process.exit(1);
        }
        // それ以外は1件失敗しても残りは続ける（すでに Threads 側で消えている投稿などがあるため）
        failed.push({ account: acc.name, day: post.day, head, reason: err.message });
        console.log(`  失敗 ${String(i + 1).padStart(4)}       @${acc.name} ${post.day} ${head} … ${err.message}`);
      }
      await sleep(WAIT_MS);
    }
  }

  console.log('');
  console.log(`削除しました: ${ok}件 / 失敗: ${failed.length}件`);
  if (failed.length) {
    console.log('失敗したもの（同じ命令をもう一度実行すると、残ったぶんだけやり直せます）:');
    for (const f of failed.slice(0, 20)) console.log(`  @${f.account} ${f.day} ${f.head} … ${f.reason}`);
    if (failed.length > 20) console.log(`  ほか ${failed.length - 20}件`);
  }
}

main().catch((err) => {
  console.error(`失敗しました: ${err.message}`);
  process.exit(1);
});
