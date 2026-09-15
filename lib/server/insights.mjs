// 反応の取り込み（03:20）。各投稿の insights を history に保存。
import { listAccounts } from './accounts.mjs';
import { listMyThreads, getInsights } from './threads.mjs';
import { upsertHistory, getHistory } from './history.mjs';
import { listPosts } from './posts.mjs';
import { nowIso } from './time.mjs';

export async function collectInsights({ now = new Date(), days = 7, accountIds } = {}) {
  const accounts = await listAccounts();
  const results = [];
  const since = new Date(now.getTime() - days * 86400000).toISOString();
  for (const acc of accounts) {
    if (accountIds && !accountIds.includes(acc.id)) continue;
    if (!acc.accessToken || !acc.threadsUserId) continue;
    let n = 0;
    try {
      const mine = await listMyThreads(acc.threadsUserId, acc.accessToken, { since, limit: 100 });
      const posted = await listPosts({ accountId: acc.id, status: 'posted', from: since, limit: 200 });
      for (const t of mine) {
        if (t.is_quote_post) continue;
        try {
          const existing = await getHistory(t.id);
          if (existing?.snapFailed) continue;
          const m = await getInsights(t.id, acc.accessToken);
          const post = posted.find((p) => p.postedThreadId === t.id);
          await upsertHistory(t.id, {
            accountId: acc.id, accountName: acc.name, text: t.text || existing?.text || '', permalink: t.permalink || existing?.permalink || null,
            timestamp: t.timestamp ? new Date(t.timestamp).toISOString() : existing?.timestamp || nowIso(), mediaType: t.media_type || 'TEXT',
            metrics: m, postId: post?.id || existing?.postId || null, type: post?.type || existing?.type || null, source: existing?.source || (post ? 'tool' : 'manual'),
          });
          n++;
        } catch (e) {
          if (e.status === 400) await upsertHistory(t.id, { accountId: acc.id, accountName: acc.name, text: t.text || '', timestamp: t.timestamp ? new Date(t.timestamp).toISOString() : nowIso(), snapFailed: String(e.message).slice(0, 200) });
        }
      }
      results.push({ account: acc.name, updated: n });
    } catch (e) {
      results.push({ account: acc.name, updated: n, error: String(e.message || e) });
    }
  }
  return results;
}
