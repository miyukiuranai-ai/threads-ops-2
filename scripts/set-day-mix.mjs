#!/usr/bin/env node
// 名義の「1日の構成」（属人系とバズ特化の割合）をまとめて変える（threads-ops2 で追加）。
//
// 構成は「割合」として使われる。属人系3・バズ特化2（＝6:4）にしておけば、
// 3本の日は属人2＋バズ1、4本の日は属人2＋バズ2、というように本数に合わせて割り振られる。
// 属人系の中の型（属人型・素の型・不安煽り型）は日替わりで順ぐりに使う。
//
// 使い方:
//   npm run mix -- --accounts kugen.japan,kugen.uranai --dry     # 変えずに、どうなるか見るだけ
//   npm run mix -- --accounts kugen.japan,kugen.uranai           # 既定の 6:4、1日3〜4本で設定
//   npm run mix -- --accounts ... --ratio 7:3 --posts 3-4
//   npm run mix -- --group keidai --ratio 6:4
//   npm run mix -- --accounts ... --reset                        # 構成の指定を外して大元のルールに戻す
import { loadEnv } from './lib/env.mjs';
import { getDb, COLLECTIONS } from '../lib/server/firebase.mjs';
import { POST_TYPES } from '../lib/server/generate.mjs';
import { spreadMix } from '../lib/server/pipeline.mjs';

// 属人系は3つの型を順ぐりに使う。バズ特化はバズ特化型を使う。
const DEFAULT_JININ = ['attract_intro', 'personal_note', 'exclusion_hook'];
const DEFAULT_BUZZ = ['buzz_engagement'];

function parseArgs(argv) {
  const args = { accounts: null, group: null, ratio: '6:4', posts: '3-4', dry: false, reset: false, jinin: DEFAULT_JININ, buzz: DEFAULT_BUZZ };
  const list = (v) => String(v ?? '').split(/[,\s、]+/).map((s) => s.trim().replace(/^@/, '')).filter(Boolean);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--accounts') args.accounts = list(argv[++i]);
    else if (a === '--group') args.group = String(argv[++i] ?? '').trim();
    else if (a === '--ratio') args.ratio = String(argv[++i] ?? '').trim();
    else if (a === '--posts') args.posts = String(argv[++i] ?? '').trim();
    else if (a === '--jinin-types') args.jinin = list(argv[++i]);
    else if (a === '--buzz-types') args.buzz = list(argv[++i]);
    else if (a === '--dry') args.dry = true;
    else if (a === '--reset') args.reset = true;
    else throw new Error(`知らない指定です: ${a}`);
  }
  return args;
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** "6:4" を、属人系と バズ特化 の本数（いちばん小さい整数の組）に直す。 */
function parseRatio(text) {
  const parts = String(text).split(/[:：]/).map((s) => Number(s.trim()));
  if (parts.length !== 2 || !parts.every((n) => Number.isInteger(n) && n >= 0) || parts[0] + parts[1] === 0) {
    throw new Error(`--ratio は "6:4" の形（属人系:バズ特化）で指定してください: ${text}`);
  }
  const g = gcd(parts[0], parts[1]) || 1;
  return { jinin: parts[0] / g, buzz: parts[1] / g };
}

function buildMix(ratio, jininTypes, buzzTypes) {
  let { jinin, buzz } = ratio;
  for (const t of [...jininTypes, ...buzzTypes]) {
    if (!POST_TYPES[t]) throw new Error(`知らない型です: ${t}`);
  }
  if (jinin > 0 && !jininTypes.length) throw new Error('属人系の型が空です。');
  if (buzz > 0 && !buzzTypes.length) throw new Error('バズ特化の型が空です。');

  // 属人系に複数の型があるときは、どの型も同じだけ使われるように数をそろえる。
  // 例: 5:5 は約分すると 1:1 になり属人型だけになってしまうので、3:3 に直して
  // 属人型・素の型・不安煽り型を1本ずつにする。割合（50:50）は変わらない。
  // 数が増えすぎるとキャラ設定の画面が読みにくくなるので、6本までに収まるときだけそろえる。
  const per = jininTypes.length;
  if (jinin > 0 && per > 1 && jinin % per !== 0) {
    const scale = per / gcd(jinin, per);
    if (jinin * scale <= 6) { jinin *= scale; buzz *= scale; }
  }

  const mix = [];
  for (let i = 0; i < jinin; i += 1) mix.push(jininTypes[i % jininTypes.length]);
  for (let i = 0; i < buzz; i += 1) mix.push(buzzTypes[i % buzzTypes.length]);
  return mix;
}

const labels = (types) => types.map((t) => POST_TYPES[t]?.label ?? t).join('＋');

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  if (!args.accounts?.length && !args.group) {
    throw new Error('--accounts 名義1,名義2 か --group 担当名 を指定してください。');
  }

  const db = getDb();
  const all = (await db.collection(COLLECTIONS.accounts).get()).docs.map((d) => ({ id: d.id, ...d.data() }));

  let targets;
  if (args.accounts?.length) {
    targets = [];
    const missing = [];
    for (const wanted of args.accounts) {
      const hit = all.find((a) => a.name === wanted || String(a.name ?? '').toLowerCase() === wanted.toLowerCase());
      if (hit) targets.push(hit);
      else missing.push(wanted);
    }
    if (missing.length) throw new Error(`名義が見つかりません: ${missing.join(', ')}（ツールに登録されている名義だけ変えられます）`);
  } else {
    targets = all.filter((a) => String(a.group ?? 'main').toLowerCase() === args.group.toLowerCase());
    if (!targets.length) throw new Error(`担当「${args.group}」の名義がありません。`);
  }

  const mix = args.reset ? [] : buildMix(parseRatio(args.ratio), args.jinin, args.buzz);
  if (!args.reset) {
    console.log(`構成: ${labels(mix)}（${args.ratio}）／1日の本数: ${args.posts}`);
    for (const n of [3, 4, 5]) {
      const got = spreadMix(mix, n, 0);
      console.log(`  ${n}本の日 → ${labels(got)}`);
    }
  } else {
    console.log('構成の指定を外します（大元のルールに戻る）。');
  }
  console.log('');

  // 同じキャラ設定を2つ以上の名義で使っていると、片方を変えるともう片方も変わる。先に知らせる。
  const usedBy = new Map();
  for (const a of all) {
    if (!a.personaId) continue;
    if (!usedBy.has(a.personaId)) usedBy.set(a.personaId, []);
    usedBy.get(a.personaId).push(a.name);
  }

  const done = [];
  const skipped = [];
  const seenPersona = new Set();
  for (const acc of targets) {
    if (!acc.personaId) { skipped.push(`@${acc.name}（キャラ設定がありません）`); continue; }
    const shared = (usedBy.get(acc.personaId) ?? []).filter((n) => n !== acc.name);
    if (shared.length) {
      console.log(`  注意: @${acc.name} のキャラ設定は @${shared.join(' / @')} と共通です。まとめて変わります。`);
    }
    if (seenPersona.has(acc.personaId)) { skipped.push(`@${acc.name}（上の名義と同じキャラ設定なので設定済み）`); continue; }
    seenPersona.add(acc.personaId);

    const ref = db.collection(COLLECTIONS.personas).doc(acc.personaId);
    if (!(await ref.get()).exists) { skipped.push(`@${acc.name}（キャラ設定 ${acc.personaId} が見つかりません）`); continue; }
    if (!args.dry) {
      const upd = { dayMix: mix, updatedAt: new Date().toISOString(), updatedBy: `set-day-mix（${process.env.OPS_USER ?? 'suzuki'}）` };
      if (!args.reset) upd.postsPerDay = args.posts;
      await ref.set(upd, { merge: true });
    }
    done.push(`@${acc.name}`);
  }

  console.log('');
  console.log(`${args.dry ? '（試しに見ただけ。何も変えていません）' : '変えました'}: ${done.length}名義`);
  if (done.length) console.log(`  ${done.join(' ')}`);
  if (skipped.length) console.log(`飛ばしたもの: ${skipped.join(' / ')}`);
  if (!args.dry) console.log('次の生成（15:30）から効きます。今日ぶんを作り直すなら npm run gen を使ってください。');
}

main().catch((err) => {
  console.error(`失敗しました: ${err.message}`);
  process.exit(1);
});
