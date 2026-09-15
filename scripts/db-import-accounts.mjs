// 名義を JSON から取り込む。npm run db:import-accounts -- --file accounts.json
// 形: [{"name":"user","threadsUserId":"...","accessToken":"...","tokenExpiresAt":"...","group":"main","personaId":"..."}]
import fs from 'node:fs';
import { main } from './_lib.mjs';
import { upsertAccount } from '../lib/server/accounts.mjs';
main(async (args) => {
  const list = JSON.parse(fs.readFileSync(String(args.file || 'accounts.json'), 'utf8'));
  const out = [];
  for (const a of list) out.push((await upsertAccount(a)).id);
  return out;
});
