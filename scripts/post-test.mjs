// テスト投稿。npm run post:test -- --account user --text "本文"（POSTING_MODE=live のときだけ実際に出す）
import { main } from './_lib.mjs';
import { resolveAccount } from '../lib/server/accounts.mjs';
import { canPost } from '../lib/server/guard.mjs';
import { publishText } from '../lib/server/threads.mjs';
main(async (args) => {
  const acc = await resolveAccount(args.account);
  if (!acc) throw new Error('名義が見つかりません');
  const g = canPost(acc);
  if (!g.ok) throw new Error(g.reason);
  if (!g.live) return { dry: true, text: args.text };
  return { threadId: await publishText(acc.threadsUserId, acc.accessToken, String(args.text || 'テスト投稿')) };
});
