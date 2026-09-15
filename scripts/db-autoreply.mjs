// 自動返信の ON/OFF。npm run db:autoreply -- --account user --on / --off
import { main } from './_lib.mjs';
import { resolveAccount, updateAccount } from '../lib/server/accounts.mjs';
main(async (args) => {
  const acc = await resolveAccount(args.account);
  if (!acc) throw new Error('名義が見つかりません');
  const on = Boolean(args.on) && !args.off;
  await updateAccount(acc.id, { autoReply: on });
  return { account: acc.name, autoReply: on };
});
