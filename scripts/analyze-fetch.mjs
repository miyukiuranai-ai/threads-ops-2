// 反応の取り込み。npm run analyze:fetch [-- --days 7 --account user]
import { main } from './_lib.mjs';
import { collectInsights } from '../lib/server/insights.mjs';
import { resolveAccount } from '../lib/server/accounts.mjs';
main(async (args) => {
  const acc = args.account ? await resolveAccount(args.account) : null;
  return collectInsights({ days: Number(args.days || 7), accountIds: acc ? [acc.id] : undefined });
});
