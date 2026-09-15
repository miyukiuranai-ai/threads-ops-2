// 投稿・返信の前に必ず通す。POSTING_MODE、名義の status、トークン期限。
import { env, isPostingLive, isReplyLive } from './env.mjs';

export function canPost(account, { kind = 'post' } = {}) {
  const live = kind === 'reply' ? isReplyLive() : isPostingLive();
  if (!account) return { ok: false, reason: '名義がありません', live };
  if (!account.accessToken || !account.threadsUserId) return { ok: false, reason: 'トークンが未登録', live };
  if (account.tokenExpiresAt && new Date(account.tokenExpiresAt).getTime() < Date.now()) return { ok: false, reason: 'トークンが失効', live };
  if (kind === 'post' && account.status !== 'active') return { ok: false, reason: `名義が ${account.status}`, live };
  if (kind === 'reply' && !account.autoReply) return { ok: false, reason: '自動返信が OFF', live };
  return { ok: true, live, mode: live ? 'live' : 'dry_run' };
}

export function modeLabel() {
  return { posting: env.POSTING_MODE, reply: env.REPLY_MODE };
}
