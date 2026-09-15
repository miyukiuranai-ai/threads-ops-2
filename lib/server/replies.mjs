// 返信。取り込み → 判定 → 送信。
import { env, farmerThreshold } from './env.mjs';
import { listAccounts, getAccount, getPersonaForAccount } from './accounts.mjs';
import { db, getDoc, setDoc, listDocs, addDoc, updateDoc, docToObj } from './firebase.mjs';
import { listMyThreads, listReplies, publishText } from './threads.mjs';
import { upsertHistory, getHistory } from './history.mjs';
import { complete, parseJson } from './ai.mjs';
import { CLASSIFY_SYSTEM } from './prompts.mjs';
import { canPost } from './guard.mjs';
import { cleanBody } from './text-clean.mjs';
import { nowIso, jstParts, minutesBetween } from './time.mjs';

export const REPLY_CATEGORIES = ['通常誘導', '長文理由', '丁寧', '遅延謝罪'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** commenters の ID。予約 ID を避ける */
export function commenterKey(username) {
  const u = String(username || '');
  if (/^__.*__$/.test(u) || /[\/.]/.test(u)) return 'u_' + u.replace(/[\/.]/g, '_');
  return u;
}

function isNight(d = new Date()) {
  const h = jstParts(d).hour;
  return h >= 2 && h < 6;
}

/** 取り込み: 直近 72 時間の自投稿に付いたコメント。手で出した投稿も Threads から読み直して history に最小の記録を作る */
export async function collectReplies({ now = new Date(), accountIds } = {}) {
  const accounts = await listAccounts();
  const results = [];
  const since = new Date(now.getTime() - 72 * 3600000).toISOString();
  for (const acc of accounts) {
    if (accountIds && !accountIds.includes(acc.id)) continue;
    if (!acc.accessToken || !acc.threadsUserId) continue;
    // 停止中でも自動返信 ON の名義は取り込む
    if (acc.status !== 'active' && !acc.autoReply) continue;
    let imported = 0, threads = 0;
    try {
      const mine = await listMyThreads(acc.threadsUserId, acc.accessToken, { since });
      for (const t of mine) {
        if (t.is_quote_post) continue;
        threads++;
        const existing = await getHistory(t.id);
        if (!existing) {
          await upsertHistory(t.id, { accountId: acc.id, accountName: acc.name, text: t.text || '', permalink: t.permalink || null, timestamp: t.timestamp ? new Date(t.timestamp).toISOString() : nowIso(), mediaType: t.media_type || 'TEXT', source: 'manual' });
        }
        const cursorId = `${acc.id}_${t.id}`;
        const cursor = await getDoc('cursors', cursorId);
        const seen = new Set(cursor?.seen || []);
        const replies = await listReplies(t.id, acc.accessToken);
        const newSeen = [...seen];
        for (const r of replies) {
          if (r.username === acc.name) continue;
          if (seen.has(r.id)) continue;
          if (await getDoc('replies', r.id)) { newSeen.push(r.id); continue; }
          const text = String(r.text || '').trim();
          const chars = Array.from(text).length;
          const arrived = r.timestamp ? new Date(r.timestamp) : now;
          await setDoc('replies', r.id, {
            accountId: acc.id, accountName: acc.name, sourceThreadId: t.id, replyId: r.id, username: r.username || '', text, mediaType: r.media_type || 'TEXT',
            charCount: chars, category: chars <= 3 ? 'keyword' : 'message', timestamp: arrived.toISOString(), arrivedAtNight: isNight(arrived),
            status: 'new', verdict: null, skipReason: null, classifiedAt: null, sentAt: null, templateId: null, createdAt: nowIso(),
          });
          await bumpCommenter(r.username, acc.id, t.id, chars > 0);
          newSeen.push(r.id);
          imported++;
        }
        await setDoc('cursors', cursorId, { accountId: acc.id, threadId: t.id, seen: newSeen.slice(-500), updatedAt: nowIso() });
      }
      results.push({ account: acc.name, threads, imported });
    } catch (e) {
      results.push({ account: acc.name, threads, imported, error: String(e.message || e) });
    }
  }
  return results;
}

async function bumpCommenter(username, accountId, threadId, hasText) {
  if (!username) return;
  const id = commenterKey(username);
  const cur = await getDoc('commenters', id);
  const accounts = new Set(cur?.accounts || []); accounts.add(accountId);
  const threads = new Set(cur?.threads || []); threads.add(threadId);
  await setDoc('commenters', id, { username, accounts: [...accounts], threads: [...threads].slice(-200), hasText: Boolean(cur?.hasText || hasText), updatedAt: nowIso() });
}

/** 判定: keyword はそのまま normal。message は Claude で分類。被り・空・画像だけ・冷やかし常習は skipped */
export async function classifyReplies({ limit = 60 } = {}) {
  const fresh = await listDocs('replies', { where: [['status', '==', 'new']], limit });
  if (!fresh.length) return { classified: 0 };
  const accounts = Object.fromEntries((await listAccounts()).map((a) => [a.id, a]));
  const toAsk = [];
  const results = [];
  const usage = [];
  for (const r of fresh) {
    const acc = accounts[r.accountId];
    const skip = async (reason) => { await updateDoc('replies', r.id, { status: 'skipped', skipReason: reason, classifiedAt: nowIso(), verdict: r.verdict || null }); results.push({ id: r.id, skipped: reason }); };
    if (!r.text) { await skip('本文が空（画像・動画だけ）'); continue; }
    const c = await getDoc('commenters', commenterKey(r.username));
    const threshold = farmerThreshold(acc?.group || 'main');
    if (c && (c.accounts || []).length >= threshold) { await skip(`被り（${(c.accounts || []).length}名義に出現）`); continue; }
    // 同じ名義で冷やかし・宣伝と判定された人
    const bad = await listDocs('replies', { where: [['username', '==', r.username], ['accountId', '==', r.accountId], ['verdict', 'in', ['negative', 'spam']]], limit: 1 });
    if (bad.length) { await skip('冷やかし・宣伝と判定した人の別コメント'); continue; }
    if (r.category === 'keyword') {
      await updateDoc('replies', r.id, { status: 'queued', verdict: 'normal', classifiedAt: nowIso() });
      results.push({ id: r.id, queued: true });
      continue;
    }
    toAsk.push(r);
  }
  if (toAsk.length) {
    const user = `コメント一覧:\n${toAsk.map((r) => `- id: ${r.id}\n  本文: ${r.text.replace(/\n/g, ' ').slice(0, 300)}`).join('\n')}`;
    let verdicts = {};
    try {
      const res = await complete({ model: 'claude-sonnet-5', system: CLASSIFY_SYSTEM, user, maxTokens: 2000, effort: 'low' });
      usage.push(res.usage);
      for (const x of parseJson(res.text).results || []) verdicts[x.id] = x.verdict;
    } catch (e) {
      results.push({ error: `分類に失敗: ${e.message}` });
    }
    for (const r of toAsk) {
      const v = ['normal', 'negative', 'spam'].includes(verdicts[r.id]) ? verdicts[r.id] : 'normal';
      if (v === 'normal') await updateDoc('replies', r.id, { status: 'queued', verdict: v, classifiedAt: nowIso() });
      else await updateDoc('replies', r.id, { status: 'skipped', verdict: v, skipReason: v === 'negative' ? '否定・冷やかし・挑発' : '宣伝', classifiedAt: nowIso() });
      results.push({ id: r.id, verdict: v });
    }
  }
  return { classified: results.length, results, usage };
}

// ---- テンプレート ----
export async function listTemplates({ accountName } = {}) {
  const list = await listDocs('replyTemplates');
  return list.filter((t) => accountName === undefined || t.accountName == null || t.accountName === accountName);
}
export async function addTemplate({ accountName = null, category = '通常誘導', text, linkStyle = 'profile' }) {
  return addDoc('replyTemplates', { accountName, category, text: String(text).trim(), linkStyle, createdAt: nowIso() });
}
export async function deleteTemplate(id) { await db().collection('replyTemplates').doc(id).delete(); }

function pickTemplate(templates, { accountName, category, recentIds, lineUrl }) {
  let pool = templates.filter((t) => t.category === category);
  const own = pool.filter((t) => t.accountName === accountName);
  if (own.length) pool = own; else pool = pool.filter((t) => t.accountName == null);
  const fresh = pool.filter((t) => !recentIds.includes(t.id));
  const list = fresh.length ? fresh : pool;
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

export function renderTemplate(text, { username, lineUrl }) {
  return cleanBody(String(text).replace(/\{\{\s*name\s*\}\}|\{name\}/g, username || '').replace(/\{\{\s*line\s*\}\}|\{line\}/g, lineUrl || ''));
}

/** 送信: コメントから 5〜30 分遅らせる。連続は 20〜60 秒。深夜 2〜6 時は送らず朝に遅延謝罪 */
export async function sendReplies({ now = new Date(), max = 5 } = {}) {
  if (isNight(now)) return { sent: 0, message: '深夜 2〜6 時は送らない' };
  const queued = await listDocs('replies', { where: [['status', '==', 'queued']], limit: 100 });
  queued.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
  const templates = await listTemplates();
  const accounts = Object.fromEntries((await listAccounts()).map((a) => [a.id, a]));
  const results = [];
  let sent = 0;
  for (const r of queued) {
    if (sent >= max) break;
    const acc = accounts[r.accountId];
    const g = canPost(acc, { kind: 'reply' });
    if (!g.ok) { results.push({ id: r.id, skipped: g.reason }); continue; }
    const age = minutesBetween(r.timestamp, now.toISOString());
    const delay = 5 + ((parseInt(String(r.id).slice(-4), 36) || 0) % 26); // 5〜30 分（ID から決めて安定させる）
    if (age < delay) continue;
    const persona = await getPersonaForAccount(acc);
    const category = r.arrivedAtNight ? '遅延謝罪' : (r.category === 'message' && r.charCount > 60 ? '長文理由' : '通常誘導');
    const recent = await listDocs('replies', { where: [['accountId', '==', r.accountId], ['status', '==', 'sent']], limit: 50 });
    const recentIds = recent.sort((a, b) => (b.sentAt || '').localeCompare(a.sentAt || '')).slice(0, 3).map((x) => x.templateId).filter(Boolean);
    const tpl = pickTemplate(templates, { accountName: acc.name, category, recentIds }) || pickTemplate(templates, { accountName: acc.name, category: '通常誘導', recentIds });
    if (!tpl) { results.push({ id: r.id, skipped: 'テンプレートがありません' }); continue; }
    const text = renderTemplate(tpl.text, { username: r.username, lineUrl: persona.lineUrl });
    try {
      if (g.live) {
        await publishText(acc.threadsUserId, acc.accessToken, text, { replyToId: r.replyId });
      }
      await updateDoc('replies', r.id, { status: 'sent', sentAt: nowIso(), templateId: tpl.id, sentText: text, dryRun: !g.live });
      results.push({ id: r.id, account: acc.name, sent: true, dry: !g.live });
      sent++;
      if (sent < max) await sleep(20000 + Math.floor(Math.random() * 40000));
    } catch (e) {
      await updateDoc('replies', r.id, { status: 'failed', skipReason: String(e.message || e).slice(0, 300) });
      results.push({ id: r.id, account: acc.name, error: e.message });
    }
  }
  return { sent, results };
}

export async function listRepliesForView({ accountIds, status, limit = 300 } = {}) {
  const where = status ? [['status', '==', status]] : [];
  let list = await listDocs('replies', { where, limit: 1000 });
  if (accountIds) list = list.filter((r) => accountIds.includes(r.accountId));
  return list.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || '')).slice(0, limit);
}

export async function countNewReplies(accountIds) {
  const list = await listDocs('replies', { where: [['status', 'in', ['new', 'queued']]], limit: 1000 });
  const out = {};
  for (const r of list) { if (accountIds && !accountIds.includes(r.accountId)) continue; out[r.accountId] = (out[r.accountId] || 0) + 1; }
  return out;
}

/** 既定のテンプレート（replies:gen） */
export const DEFAULT_TEMPLATES = [
  { category: '通常誘導', text: '{name} 様、このたびはご連絡いただきありがとうございます。鑑定文が2000文字を超えてまいりますので、プロフィールのリンクよりご連絡いただけますでしょうか。' },
  { category: '通常誘導', text: '{name} 様、お声をありがとうございます。しっかり視させていただきましたので、続きはプロフィールのリンクからお受け取りください。' },
  { category: '長文理由', text: '{name} 様、詳しく書いてくださりありがとうございます。ここでは書ききれない長さになりましたので、プロフィールのリンクよりお受け取りいただけますでしょうか。' },
  { category: '丁寧', text: '{name} 様、このたびはありがとうございます。お一人お一人に向き合っておりますので、プロフィールのリンクよりご連絡くださいませ。' },
  { category: '遅延謝罪', text: '{name} 様、夜分にお声をいただいていたのにお返事が遅くなり申し訳ありません。視えたことを書きましたので、プロフィールのリンクよりお受け取りください。' },
];

export { docToObj };
