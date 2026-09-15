// 運用の命令（Claude Code から使う。API の費用はかからない＝定額のアカウントで Claude が動かす）。
//
//   npm run ops -- list-drafts --account uta001012 [--date 2026-09-12]
//   npm run ops -- directive   --account uta001012 --action one_buzz [--date ...] [--no-regenerate]
//   npm run ops -- directive   --account uta001012 --types buzz_engagement,attract_intro   # その日だけ構成を指定
//   npm run ops -- generate    --account uta001012 --types attract_intro,buzz_engagement --slots 07:20,21:00 [--date ...] [--replace] [--instruction "合図は🙏。暦は使わない"]
//   npm run ops -- edit-draft  --account uta001012 --time 23:47 --body-file ./body.txt [--date ...] [--keyword 🙏]
//   npm run ops -- delete-post --account uta001012 --time 21:42 [--date ...]   # 投稿済みを Threads から消す（戻せない）
//   npm run ops -- persona     --account uta001012 --set askPerDay=2-3 --set buzzTrial=true --set bands="21:00-01:00|04:00-09:00"
//   npm run ops -- lines       [--bad 300 --good 1000 --buzz 3000]   # 表示数の良い・悪いの線（全名義共通）。引数なしで今の線を見る
//
// 名義は @ユーザー名でも名前（星蘭）でもよい。誰が操作したかは OPS_USER（既定は suzuki）で記録する。
// 生成は Anthropic API を使うので、そこだけは費用がかかる（1回数円〜十数円）。
import { readFileSync } from 'node:fs';
import { getDb, COLLECTIONS } from '../lib/server/firebase.mjs';
import { runTool, TOOLS } from '../lib/server/chat-tools.mjs';

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const args = { _: cmd, set: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = rest[i + 1];
    if (key === 'set') {
      args.set.push(next);
      i += 1;
    } else if (key === 'replace' || key === 'no-regenerate') {
      args[key] = true;
    } else if (next !== undefined && !next.startsWith('--')) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function usage() {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
}

function coerce(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  if (v.includes('|')) return v.split('|').map((s) => s.trim()).filter(Boolean);
  return v;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args._ || args.help) return usage();

  const user = { name: process.env.OPS_USER || 'suzuki', role: process.env.OPS_ROLE || 'member' };
  const accSnap = await getDb().collection(COLLECTIONS.accounts).get();
  const accounts = accSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const ctx = { user, accounts };

  const cmdToTool = {
    'list-drafts': () => ['list_drafts', { account: args.account, date: args.date }],
    directive: () => [
      'set_day_directive',
      {
        account: args.account,
        action: args.types ? 'mix' : args.action,
        types: args.types ? String(args.types).split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        date: args.date,
        regenerate: !args['no-regenerate'],
      },
    ],
    generate: () => [
      'generate_posts',
      {
        account: args.account,
        date: args.date,
        types: String(args.types ?? '').split(',').map((s) => s.trim()).filter(Boolean),
        slots: String(args.slots ?? '').split(',').map((s) => s.trim()).filter(Boolean),
        replace: Boolean(args.replace),
        instruction: args.instruction ?? '',
      },
    ],
    'delete-post': () => ['delete_post', { account: args.account, date: args.date, time: args.time }],
    lines: () => ['set_impression_lines', Object.fromEntries(['bad', 'good', 'buzz'].filter((k) => args[k] !== undefined).map((k) => [k, Number(args[k])]))],
    'edit-draft': () => [
      'edit_draft',
      {
        account: args.account,
        date: args.date,
        time: args.time,
        body: args['body-file'] ? readFileSync(args['body-file'], 'utf8') : args.body,
        ...(args.keyword !== undefined ? { keyword: args.keyword === 'none' ? '' : args.keyword } : {}),
      },
    ],
    persona: () => {
      const input = { account: args.account };
      for (const kv of args.set) {
        const i = kv.indexOf('=');
        if (i === -1) throw new Error(`--set は key=value の形で: ${kv}`);
        const key = kv.slice(0, i).trim();
        const val = kv.slice(i + 1).trim();
        if (key === 'styleRulesAdd' || key === 'styleRulesRemove' || key === 'bands') input[key] = val.split('|').map((s) => s.trim()).filter(Boolean);
        else input[key] = coerce(val);
      }
      return ['update_persona', input];
    },
  };

  const make = cmdToTool[args._];
  if (!make) {
    console.error(`知らない命令です: ${args._}`);
    usage();
    process.exit(1);
  }
  const [tool, input] = make();
  if (!TOOLS.some((t) => t.name === tool)) throw new Error(`道具が見つかりません: ${tool}`);

  const out = await runTool(tool, input, ctx);
  console.log(out);
}

main().catch((err) => {
  console.error(`失敗しました: ${err.message}`);
  process.exit(1);
});
