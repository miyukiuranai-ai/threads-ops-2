// 定期実行の入口から呼ぶまとまり。
import { env } from './env.mjs';
import { listAccounts } from './accounts.mjs';
import { withRun, cleanupRuns } from './runs.mjs';
import { generateForAll } from './pipeline.mjs';
import { generateReport } from './report.mjs';
import { refreshTokens } from './tokens.mjs';
import { publishDue, deleteFlops } from './publish.mjs';
import { autoReview, autoApproveSwitched } from './auto-review.mjs';
import { perPostSwitch } from './per-post.mjs';
import { collectInsights } from './insights.mjs';
import { takeSnapshots } from './impressions.mjs';
import { collectReplies, classifyReplies, sendReplies } from './replies.mjs';
import { sumUsage } from './ai.mjs';
import { jstDate, addDays, isAround } from './time.mjs';

/** 15:30 JST: 前日のレポート → 翌日ぶんの生成 → 古い runs の削除 */
export async function jobGenerate({ date } = {}) {
  return withRun('generate', async (results) => {
    const today = jstDate();
    const target = date || addDays(today, 1);
    let report = null;
    try {
      report = await generateReport(addDays(today, -1));
      results.push({ step: 'report', date: report.date, alerts: (report.alerts || []).length, usage: report.usage });
    } catch (e) { results.push({ step: 'report', error: String(e.message || e) }); }
    const accounts = await listAccounts({ status: 'active' });
    const gen = await generateForAll(accounts, { date: target, generatedBy: 'cron' });
    for (const g of gen) results.push({ step: 'generate', ...g });
    const cleaned = await cleanupRuns({ days: 30 });
    results.push({ step: 'cleanup', deleted: cleaned });
    const usage = sumUsage([report?.usage ? { model: 'claude-opus-5', inputTokens: report.usage.inputTokens, outputTokens: report.usage.outputTokens } : null, ...gen.map((g) => g.usage)]);
    return { message: `${target} ぶん ${gen.filter((g) => g.count).length} 名義`, usage };
  });
}

/** 21:00 UTC: トークン延長 */
export async function jobRefreshTokens() {
  return withRun('refresh-tokens', async (results) => {
    const r = await refreshTokens();
    results.push(...r);
    return { message: `${r.filter((x) => x.refreshed).length} 件延長` };
  });
}

/**
 * 5 分おき: 23:30 の自動仕分け → 作り直した投稿の自動承認 → 投稿 → 投稿ごとの切り替え →
 * 03:20 の反応取り込み → 1時間後・3時間後の取得 → 反応 0 のバズ型の削除
 */
export async function jobPublish({ now = new Date() } = {}) {
  return withRun('publish', async (results) => {
    const usages = [];
    if (isAround(env.AUTO_REVIEW_AT, 5, now)) {
      try { results.push({ step: 'auto-review', results: await autoReview({ now }) }); } catch (e) { results.push({ step: 'auto-review', error: String(e.message || e) }); }
    }
    try { results.push({ step: 'auto-approve', results: await autoApproveSwitched({ now }) }); } catch (e) { results.push({ step: 'auto-approve', error: String(e.message || e) }); }
    try { results.push({ step: 'publish', results: await publishDue({ now }) }); } catch (e) { results.push({ step: 'publish', error: String(e.message || e) }); }
    try {
      const sw = await perPostSwitch({ now });
      usages.push(...sw.map((s) => s.usage));
      results.push({ step: 'per-post-switch', results: sw });
    } catch (e) { results.push({ step: 'per-post-switch', error: String(e.message || e) }); }
    if (isAround(env.INSIGHTS_COLLECT_AT, 5, now)) {
      try { results.push({ step: 'insights', results: await collectInsights({ now }) }); } catch (e) { results.push({ step: 'insights', error: String(e.message || e) }); }
    }
    try {
      const accounts = await listAccounts();
      results.push({ step: 'snapshots', results: await takeSnapshots(accounts, { now }) });
    } catch (e) { results.push({ step: 'snapshots', error: String(e.message || e) }); }
    try { results.push({ step: 'flops', results: await deleteFlops({ now }) }); } catch (e) { results.push({ step: 'flops', error: String(e.message || e) }); }
    const posted = results.find((r) => r.step === 'publish')?.results?.filter((x) => x.status === 'posted').length || 0;
    return { message: `${posted} 本投稿`, usage: sumUsage(usages) };
  });
}

/** 5 分おき: コメントの取り込み → 判定 → 送信。取り込みは 15 分に 1 回 */
export async function jobReplies({ now = new Date(), forceCollect = false } = {}) {
  return withRun('replies', async (results) => {
    const usages = [];
    const minute = now.getUTCMinutes();
    if (forceCollect || minute % 15 < 5) {
      try { results.push({ step: 'collect', results: await collectReplies({ now }) }); } catch (e) { results.push({ step: 'collect', error: String(e.message || e) }); }
    }
    try {
      const c = await classifyReplies();
      usages.push(...(c.usage || []));
      results.push({ step: 'classify', classified: c.classified });
    } catch (e) { results.push({ step: 'classify', error: String(e.message || e) }); }
    try { results.push({ step: 'send', ...(await sendReplies({ now })) }); } catch (e) { results.push({ step: 'send', error: String(e.message || e) }); }
    return { message: `送信 ${results.find((r) => r.step === 'send')?.sent || 0}`, usage: sumUsage(usages) };
  });
}
