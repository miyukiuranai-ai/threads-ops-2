// 権限の確認。npm run threads:check [-- --account user]
import { main } from './_lib.mjs';
import { listAccounts, resolveAccount } from '../lib/server/accounts.mjs';
import { checkPermissions } from '../lib/server/threads.mjs';
main(async (args) => {
  const accounts = args.account ? [await resolveAccount(args.account)].filter(Boolean) : await listAccounts();
  const out = [];
  for (const a of accounts) { try { out.push({ account: a.name, ...(await checkPermissions(a.accessToken)) }); } catch (e) { out.push({ account: a.name, error: e.message }); } }
  return out;
});
