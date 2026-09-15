// 実行ログ（runs）。30 日で削除。
import { db, addDoc, updateDoc, listDocs } from './firebase.mjs';
import { nowIso } from './time.mjs';

export async function startRun(job, extra = {}) {
  const id = await addDoc('runs', { job, startedAt: nowIso(), finishedAt: null, results: [], message: '', error: null, ...extra });
  return id;
}

export async function finishRun(id, { results = [], message = '', error = null, usage = null } = {}) {
  await updateDoc('runs', id, { finishedAt: nowIso(), results: results.map(safe), message, error: error ? String(error?.message || error) : null, usage });
}

/** Firestore に入れられる形に（undefined を落とす、深すぎるものを文字列に） */
function safe(v) {
  try { return JSON.parse(JSON.stringify(v ?? null)); } catch { return String(v); }
}

/** ジョブを包む。名義単位の例外は results に入れて続ける */
export async function withRun(job, fn, extra = {}) {
  const id = await startRun(job, extra);
  const results = [];
  try {
    const out = await fn(results);
    const usage = out?.usage || null;
    await finishRun(id, { results, message: out?.message || '', usage });
    return { runId: id, results, ...out };
  } catch (e) {
    await finishRun(id, { results, error: e });
    throw e;
  }
}

export async function recentRuns({ limit = 20, job } = {}) {
  const list = await listDocs('runs', { orderBy: ['startedAt', 'desc'], limit: job ? 200 : limit });
  return (job ? list.filter((r) => r.job === job) : list).slice(0, limit);
}

export async function recentErrors({ limit = 10 } = {}) {
  const runs = await listDocs('runs', { orderBy: ['startedAt', 'desc'], limit: 100 });
  return runs.filter((r) => r.error || (r.results || []).some((x) => x && x.error)).slice(0, limit);
}

export async function cleanupRuns({ days = 30 } = {}) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const snap = await db().collection('runs').where('startedAt', '<', cutoff).limit(400).get();
  if (snap.empty) return 0;
  const batch = db().batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
}

/** 直近 N 日の usage の合計（残高の見積もり用） */
export async function usageSince(days = 7) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const runs = await listDocs('runs', { where: [['startedAt', '>=', cutoff]] });
  let usd = 0, calls = 0;
  for (const r of runs) {
    if (r.usage?.usd) { usd += r.usage.usd; calls += r.usage.calls || 0; }
    for (const x of r.results || []) if (x?.usage?.usd) { usd += x.usage.usd; calls += x.usage.calls || 1; }
  }
  return { usd, calls, days };
}
