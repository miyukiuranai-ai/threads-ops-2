// 投稿の削除。npm run post:delete -- --id 投稿ID（posts の ID）または --account user --thread threadId
import { main } from './_lib.mjs';
import { deletePostedThread } from '../lib/server/publish.mjs';
import { resolveAccount } from '../lib/server/accounts.mjs';
import { deleteThread } from '../lib/server/threads.mjs';
main(async (args) => {
  if (args.id) { await deletePostedThread(String(args.id), process.env.OPS_USER || 'cli'); return { deleted: args.id }; }
  const acc = await resolveAccount(args.account);
  if (!acc || !args.thread) throw new Error('--id か --account と --thread が要ります');
  return deleteThread(String(args.thread), acc.accessToken);
});
