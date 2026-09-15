// 承認済みで予定時刻を過ぎた投稿を送る。20 分以上遅れは missed。
import { env } from './env.mjs';
import { listAccounts, getAccount } from './accounts.mjs';
import { listPosts, updatePost, getPost } from './posts.mjs';
import { canPost } from './guard.mjs';
import { createContainer, createCarouselItem, waitForContainer, publishContainer, getPermalink, deleteThread } from './threads.mjs';
import { signedReadUrl } from './storage.mjs';
import { upsertHistory, markDeleted } from './history.mjs';
import { rewriteLeadingTime } from './text-clean.mjs';
import { nowIso, jstParts, minutesBetween } from './time.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 1 本を Threads に出す（guard 済み前提）。dry_run では publish を呼ばない */
export async function publishOne(post, account, { live }) {
  const now = new Date();
  const p = jstParts(now);
  const body = rewriteLeadingTime(post.body, p.hour, p.minute);
  const media = post.media || [];
  if (!live) {
    return { dry: true, body, mediaCount: media.length };
  }
  const uid = account.threadsUserId;
  const token = account.accessToken;
  let containerId;
  const make = async () => {
    if (!media.length) {
      return createContainer(uid, token, { text: body, mediaType: 'TEXT' });
    }
    if (media.length === 1) {
      const m = media[0];
      const url = await signedReadUrl(m.path, { minutes: 60 });
      const isVideo = m.kind === 'video' || String(m.contentType || '').startsWith('video/');
      return createContainer(uid, token, { text: body, mediaType: isVideo ? 'VIDEO' : 'IMAGE', imageUrl: isVideo ? undefined : url, videoUrl: isVideo ? url : undefined });
    }
    const children = [];
    for (const m of media.slice(0, 10)) {
      const url = await signedReadUrl(m.path, { minutes: 60 });
      const isVideo = m.kind === 'video' || String(m.contentType || '').startsWith('video/');
      const cid = await createCarouselItem(uid, token, { imageUrl: isVideo ? undefined : url, videoUrl: isVideo ? url : undefined });
      await waitForContainer(cid, token, { waitMinutes: 3 });
      children.push(cid);
    }
    return createContainer(uid, token, { text: body, mediaType: 'CAROUSEL', children });
  };
  try {
    containerId = await make();
  } catch (e) {
    if (!media.length) throw e;
    // 画像つきのコンテナ作成が失敗したら 10 秒後に一度だけ作り直す
    await sleep(10000);
    containerId = await make();
  }
  if (media.length) await waitForContainer(containerId, token, { waitMinutes: 5 });
  else await sleep(3000);
  const threadId = await publishContainer(uid, token, containerId);
  let permalink = null;
  try { permalink = await getPermalink(threadId, token); } catch { /* 無くてもよい */ }
  return { threadId, permalink, body, mediaCount: media.length };
}

/** 承認済みの投稿を送る。相乗りの処理は cron-jobs 側で */
export async function publishDue({ now = new Date(), accountIds } = {}) {
  const grace = env.PUBLISH_GRACE_MINUTES;
  const nowIsoStr = now.toISOString();
  const due = await listPosts({ status: 'approved', to: nowIsoStr, limit: 200 });
  const results = [];
  const accounts = {};
  for (const post of due) {
    if (accountIds && !accountIds.includes(post.accountId)) continue;
    const late = minutesBetween(post.scheduledAt, nowIsoStr);
    if (late > grace) {
      await updatePost(post.id, { status: 'missed', holdReason: `予定より ${Math.round(late)} 分遅れ` });
      results.push({ account: post.accountName, postId: post.id, status: 'missed', late: Math.round(late) });
      continue;
    }
    try {
      const account = accounts[post.accountId] ||= await getAccount(post.accountId);
      const g = canPost(account);
      if (!g.ok) {
        await updatePost(post.id, { status: 'failed', holdReason: g.reason });
        results.push({ account: post.accountName, postId: post.id, status: 'failed', error: g.reason });
        continue;
      }
      if (post.imageRequired && !(post.media || []).length) {
        await updatePost(post.id, { status: 'held', holdReason: '画像が未準備' });
        results.push({ account: post.accountName, postId: post.id, status: 'held' });
        continue;
      }
      const r = await publishOne(post, account, { live: g.live });
      if (r.dry) {
        await updatePost(post.id, { status: 'posted', postedAt: nowIso(), postedThreadId: `dry_${post.id}`, body: r.body, dryRun: true });
        results.push({ account: post.accountName, postId: post.id, status: 'posted', dry: true });
        continue;
      }
      await updatePost(post.id, { status: 'posted', postedAt: nowIso(), postedThreadId: r.threadId, permalink: r.permalink || null, body: r.body });
      await upsertHistory(r.threadId, {
        accountId: account.id, accountName: account.name, postId: post.id, text: r.body, permalink: r.permalink || null,
        timestamp: nowIso(), mediaType: r.mediaCount ? (r.mediaCount > 1 ? 'CAROUSEL_ALBUM' : 'IMAGE') : 'TEXT', type: post.type, source: 'tool',
      });
      results.push({ account: post.accountName, postId: post.id, status: 'posted', threadId: r.threadId });
    } catch (e) {
      await updatePost(post.id, { status: 'failed', holdReason: String(e.message || e).slice(0, 300) });
      results.push({ account: post.accountName, postId: post.id, status: 'failed', error: String(e.message || e) });
    }
  }
  return results;
}

/** 投稿済みを Threads から削除（確認は画面側） */
export async function deletePostedThread(postId, by) {
  const post = await getPost(postId);
  if (!post) throw new Error('投稿がありません');
  const account = await getAccount(post.accountId);
  if (post.postedThreadId && !String(post.postedThreadId).startsWith('dry_') && account?.accessToken) {
    await deleteThread(post.postedThreadId, account.accessToken);
    await markDeleted(post.postedThreadId, by);
  }
  await updatePost(postId, { status: 'deleted', deletedAt: nowIso(), deletedBy: by || null });
  return true;
}

/** 24 時間で反応 0 のバズ型を消す（autoDeleteFlops） */
export async function deleteFlops({ now = new Date() } = {}) {
  const { getPersonaForAccount } = await import('./accounts.mjs');
  const { getInsights } = await import('./threads.mjs');
  const results = [];
  const from = new Date(now.getTime() - 48 * 3600000).toISOString();
  const to = new Date(now.getTime() - 24 * 3600000).toISOString();
  const posts = await listPosts({ status: 'posted', from, to, limit: 300 });
  const accounts = {};
  for (const p of posts) {
    if (p.flopChecked || !['buzz_engagement', 'image_buzz'].includes(p.type)) continue;
    if (!p.postedThreadId || String(p.postedThreadId).startsWith('dry_')) { await updatePost(p.id, { flopChecked: true, flopResult: 'dry' }); continue; }
    try {
      const account = accounts[p.accountId] ||= await getAccount(p.accountId);
      const persona = await getPersonaForAccount(account);
      if (persona.autoDeleteFlops === false) { await updatePost(p.id, { flopChecked: true, flopResult: 'off' }); continue; }
      const m = await getInsights(p.postedThreadId, account.accessToken);
      const total = (m.likes || 0) + (m.replies || 0) + (m.reposts || 0) + (m.quotes || 0);
      if (total === 0 && canPost(account).live) {
        await deleteThread(p.postedThreadId, account.accessToken);
        await markDeleted(p.postedThreadId, 'auto');
        await updatePost(p.id, { flopChecked: true, flopResult: 'deleted', flopCounts: m, status: 'deleted', deletedAt: nowIso(), deletedBy: 'auto' });
        results.push({ account: p.accountName, postId: p.id, deleted: true });
      } else {
        await updatePost(p.id, { flopChecked: true, flopResult: total === 0 ? 'zero_dry' : 'kept', flopCounts: m });
      }
    } catch (e) {
      results.push({ account: p.accountName, postId: p.id, error: e.message });
    }
  }
  return results;
}

export { listAccounts };
