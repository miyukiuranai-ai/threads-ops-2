// 長期トークンを名義に保存。npm run token:import -- --token XXX [--name user] [--group main] [--days 60]
import { main } from './_lib.mjs';
import { getMe } from '../lib/server/threads.mjs';
import { upsertAccount } from '../lib/server/accounts.mjs';
main(async (args) => {
  if (!args.token) throw new Error('--token が要ります');
  const me = await getMe(String(args.token));
  const days = Number(args.days || 60);
  return upsertAccount({ name: args.name || me.username, threadsUserId: String(me.id), accessToken: String(args.token), tokenExpiresAt: new Date(Date.now() + days * 86400000).toISOString(), group: args.group || undefined });
});
