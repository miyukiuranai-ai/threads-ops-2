// 投稿の生成。npm run gen -- --account 名義 --date 日付 [--types a,b --slots HH:MM,HH:MM] [--instruction 文] [--force] [--dry]
import { main } from './_lib.mjs';
import { listAccounts, resolveAccount } from '../lib/server/accounts.mjs';
import { generateForAccount, generateForAll } from '../lib/server/pipeline.mjs';
import { withRun } from '../lib/server/runs.mjs';
import { jstDate, addDays } from '../lib/server/time.mjs';
main(async (args) => {
  const date = args.date || addDays(jstDate(), 1);
  const opts = { date, types: args.types ? String(args.types).split(',') : undefined, slots: args.slots ? String(args.slots).split(',') : undefined, instruction: args.instruction, force: Boolean(args.force), dry: Boolean(args.dry), generatedBy: `cli:${process.env.OPS_USER || 'cli'}` };
  if (args.account) {
    const acc = await resolveAccount(args.account);
    if (!acc) throw new Error('名義が見つかりません');
    if (opts.dry) return generateForAccount(acc, opts);
    return withRun('gen', async (results) => { const r = await generateForAccount(acc, opts); results.push(r); return { message: `${acc.name} ${date}`, usage: r.usage }; });
  }
  const accounts = await listAccounts({ status: 'active' });
  if (opts.dry) return generateForAll(accounts, opts);
  return withRun('gen', async (results) => { const r = await generateForAll(accounts, opts); results.push(...r); return { message: `${date} 全名義` }; });
});
