// コードを長期トークンに。npm run auth:exchange -- --code XXXX [--import]
import { main, out } from './_lib.mjs';
import { exchangeCode, getMe } from '../lib/server/threads.mjs';
import { upsertAccount } from '../lib/server/accounts.mjs';
main(async (args) => {
  if (!args.code) throw new Error('--code が要ります');
  const r = await exchangeCode(String(args.code));
  const me = await getMe(r.accessToken);
  const exp = new Date(Date.now() + (r.expiresIn || 60 * 86400) * 1000).toISOString();
  out({ username: me.username, userId: me.id, expiresAt: exp, accessToken: r.accessToken });
  if (args.import) { const acc = await upsertAccount({ name: me.username, threadsUserId: String(me.id), accessToken: r.accessToken, tokenExpiresAt: exp, group: args.group || undefined }); out(`取り込み: ${acc.id}`); }
});
