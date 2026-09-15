// 23:30 の自動仕分け。承認待ちのうち: 画像が要るのに素材が無い → 却下、予定を 20 分以上過ぎた → 却下、文章だけ → 承認。
import { env } from './env.mjs';
import { listAccounts } from './accounts.mjs';
import { listPosts, updatePost } from './posts.mjs';
import { nowIso, minutesBetween } from './time.mjs';

export async function autoReview({ now = new Date() } = {}) {
  const accounts = await listAccounts();
  const exempt = new Set(accounts.filter((a) => a.autoReviewExempt).map((a) => a.id));
  const manualOnly = new Set(accounts.filter((a) => a.manualOnly).map((a) => a.id));
  const grace = env.PUBLISH_GRACE_MINUTES;
  const pending = await listPosts({ statuses: ['pending', 'held'], limit: 500 });
  const results = [];
  for (const p of pending) {
    if (exempt.has(p.accountId)) continue;
    const late = minutesBetween(p.scheduledAt, now.toISOString());
    if (late > grace) {
      await updatePost(p.id, { status: 'rejected', rejectedReason: '自動仕分け: 予定時刻を過ぎた', reviewedAt: nowIso(), editedBy: 'auto' });
      results.push({ account: p.accountName, postId: p.id, result: 'rejected_late' });
      continue;
    }
    if (p.imageRequired && !(p.media || []).length) {
      await updatePost(p.id, { status: 'rejected', rejectedReason: '自動仕分け: 画像が要るのに素材が無い', reviewedAt: nowIso(), editedBy: 'auto' });
      results.push({ account: p.accountName, postId: p.id, result: 'rejected_no_image' });
      continue;
    }
    if (p.status !== 'pending') continue; // 保留は人が見る
    if (manualOnly.has(p.accountId)) continue; // 手動承認のみの名義は自動承認しない
    await updatePost(p.id, { status: 'approved', reviewedAt: nowIso(), editedBy: 'auto', holdReason: null });
    results.push({ account: p.accountName, postId: p.id, result: 'approved' });
  }
  return results;
}

/** 作り直した投稿（autoApprove）が投稿時刻を迎えて承認待ちなら自動で承認 */
export async function autoApproveSwitched({ now = new Date() } = {}) {
  const pending = await listPosts({ status: 'pending', to: now.toISOString(), limit: 200 });
  const results = [];
  for (const p of pending) {
    if (!p.autoApprove) continue;
    if (p.imageRequired && !(p.media || []).length) continue;
    await updatePost(p.id, { status: 'approved', reviewedAt: nowIso(), editedBy: 'auto' });
    results.push({ account: p.accountName, postId: p.id, result: 'auto_approved' });
  }
  return results;
}
