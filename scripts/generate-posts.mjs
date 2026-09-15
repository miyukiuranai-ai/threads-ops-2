#!/usr/bin/env node
// 投稿案を生成して Firestore の posts へ pending で積む。投稿は行わない。
// 本番では Vercel Cron が /api/cron/generate を叩く。
//
// 使い方:
//   npm run gen -- --account seiran_uranai_          # 1名義（Personaの設定通り）
//   npm run gen -- --all                             # 稼働中の全名義
//   npm run gen -- --account seiran_uranai_ --dry    # 保存せず表示だけ
//   npm run gen -- --account seiran_uranai_ --types attract_intro --slots 23:40
import { loadEnv } from './lib/env.mjs';
import { listGeneratableAccounts, generateForAccount, generateDaily } from '../lib/server/pipeline.mjs';
import { toJstTime } from '../lib/server/schedule.mjs';

function parseArgs(argv) {
  const args = { account: null, all: false, dry: false, types: null, slots: null, date: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--account') args.account = argv[++i];
    else if (a === '--all') args.all = true;
    else if (a === '--dry') args.dry = true;
    else if (a === '--types') args.types = argv[++i].split(',');
    else if (a === '--slots') args.slots = argv[++i].split(',');
    else if (a === '--date') args.date = argv[++i];
  }
  return args;
}

function printPost(post) {
  console.log(
    `--- ${post.slot} → ${toJstTime(post.scheduledAt)}（ジッター適用・日本時間） [${post.type}] ${post.slotName ?? ''} ---`
  );
  console.log(post.body);
  if (post.keyword) console.log(`（合言葉: ${post.keyword}）`);
  if (post.imageBrief) console.log(`（必要な画像: ${post.imageBrief}）`);
  if (post.intent) console.log(`（狙い: ${post.intent}）`);
  console.log('');
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));

  if (args.all && !args.dry) {
    const { results } = await generateDaily({ date: args.date });
    for (const r of results) {
      console.log(
        r.result === 'ok'
          ? `[ok] @${r.account} ${r.count}件（入力${r.usage.input_tokens} / 出力${r.usage.output_tokens}）`
          : `[失敗] @${r.account} ${r.reason}`
      );
    }
    console.log('\n承認待ちとして保存しました。管理画面の「投稿予定」で確認してください。');
    return;
  }

  if (!args.account) throw new Error('--account で名義を指定するか、--all を付けてください。');

  const [account] = await listGeneratableAccounts(args.account);
  const { persona, posts, usage, date, note } = await generateForAccount(account, {
    types: args.types,
    slots: args.slots,
    date: args.date,
    dry: args.dry,
  });

  console.log(`@${account.name} / Persona: ${persona.name} / 対象日: ${date}\n`);
  posts.forEach(printPost);

  console.log(
    args.dry
      ? '--dry のため保存していません。'
      : `${posts.length}件を承認待ちとして保存しました。管理画面の「投稿予定」で確認してください。`
  );
  if (note) console.log(`注記: ${note}`);
  if (usage) console.log(`使用トークン: 入力${usage.input_tokens} / 出力${usage.output_tokens}`);

  // 利用額の集計に入るよう、コマンドから回したぶんも実行ログに残す
  if (!args.dry) {
    const { getDb, COLLECTIONS } = await import('../lib/server/firebase.mjs');
    await getDb().collection(COLLECTIONS.runs).add({
      job: 'generate',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: 'ok',
      message: `手動生成: @${account.name}`,
      results: [{ account: account.name, result: 'ok', count: posts.length, usage }],
    });
  }
}

main().catch((err) => {
  console.error('\n失敗しました: ' + err.message);
  process.exit(1);
});
