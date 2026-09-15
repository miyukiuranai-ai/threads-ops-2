// Threads 公式 API（graph.threads.net）。ブラウザ操作はしない。
import { env } from './env.mjs';

const BASE = 'https://graph.threads.net/v1.0';
const AUTH = 'https://threads.net/oauth/authorize';
const SCOPES = ['threads_basic', 'threads_content_publish', 'threads_read_replies', 'threads_manage_replies', 'threads_manage_insights', 'threads_delete'];

async function call(path, { method = 'GET', token, params = {}, body } = {}) {
  const url = new URL(path.startsWith('http') ? path : `${BASE}${path}`);
  if (token) url.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, String(v));
  const init = { method, headers: {} };
  if (body) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch(url, init);
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = json?.error?.message || json?.error_message || text || `${res.status}`;
    const err = new Error(`Threads API ${res.status}: ${msg}`);
    err.status = res.status;
    err.code = json?.error?.code;
    err.body = json;
    throw err;
  }
  return json;
}

export function authUrl({ state = 'to2' } = {}) {
  const u = new URL(AUTH);
  u.searchParams.set('client_id', env.THREADS_APP_ID);
  u.searchParams.set('redirect_uri', env.THREADS_REDIRECT_URI);
  u.searchParams.set('scope', SCOPES.join(','));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('state', state);
  return u.toString();
}

/** 認可コード → 短期トークン → 長期トークン（60日） */
export async function exchangeCode(code) {
  const form = new URLSearchParams({
    client_id: env.THREADS_APP_ID,
    client_secret: env.THREADS_APP_SECRET,
    grant_type: 'authorization_code',
    redirect_uri: env.THREADS_REDIRECT_URI,
    code: code.replace(/#_$/, ''),
  });
  const res = await fetch(`${BASE}/oauth/access_token`, { method: 'POST', body: form });
  const short = await res.json();
  if (!res.ok || !short.access_token) throw new Error(`短期トークンの取得に失敗: ${JSON.stringify(short)}`);
  const long = await call('/access_token', { params: { grant_type: 'th_exchange_token', client_secret: env.THREADS_APP_SECRET, access_token: short.access_token } });
  return { accessToken: long.access_token, expiresIn: long.expires_in, userId: String(short.user_id) };
}

/** 長期トークンの延長（残り 24 時間以上・7 日経過で可） */
export async function refreshLongLivedToken(token) {
  const r = await call('/refresh_access_token', { params: { grant_type: 'th_refresh_token', access_token: token } });
  return { accessToken: r.access_token, expiresIn: r.expires_in };
}

export async function getMe(token) {
  return call('/me', { token, params: { fields: 'id,username,name,threads_profile_picture_url' } });
}

/** 権限の確認（threads:check） */
export async function checkPermissions(token) {
  const me = await getMe(token);
  const out = { me, ok: true, checks: {} };
  try { await call(`/${me.id}/threads`, { token, params: { fields: 'id', limit: 1 } }); out.checks.threads_basic = true; } catch (e) { out.checks.threads_basic = e.message; out.ok = false; }
  try { await call(`/${me.id}/threads_insights`, { token, params: { metric: 'views', period: 'day' } }); out.checks.threads_manage_insights = true; } catch (e) { out.checks.threads_manage_insights = e.message; }
  return out;
}

/** 自分の投稿の一覧 */
export async function listMyThreads(userId, token, { since, limit = 50 } = {}) {
  const params = { fields: 'id,text,timestamp,media_type,permalink,is_quote_post,shortcode', limit };
  if (since) params.since = Math.floor(new Date(since).getTime() / 1000);
  const r = await call(`/${userId}/threads`, { token, params });
  return r.data || [];
}

export async function getThread(id, token) {
  return call(`/${id}`, { token, params: { fields: 'id,text,timestamp,media_type,permalink,username' } });
}

/** 投稿に付いた返信（1階層） */
export async function listReplies(threadId, token, { after } = {}) {
  const out = [];
  let cursor = after;
  for (let i = 0; i < 10; i++) {
    const params = { fields: 'id,text,username,timestamp,media_type,has_replies,root_post,replied_to,is_reply,hide_status', limit: 100 };
    if (cursor) params.after = cursor;
    const r = await call(`/${threadId}/replies`, { token, params });
    out.push(...(r.data || []));
    cursor = r.paging?.cursors?.after;
    if (!r.paging?.next) break;
  }
  return out;
}

/** 投稿の反応 */
export async function getInsights(threadId, token) {
  const r = await call(`/${threadId}/insights`, { token, params: { metric: 'views,likes,replies,reposts,quotes,shares' } });
  const m = { views: 0, likes: 0, replies: 0, reposts: 0, quotes: 0, shares: 0 };
  for (const item of r.data || []) {
    const v = item.values?.[0]?.value ?? item.total_value?.value ?? 0;
    if (m[item.name] != null) m[item.name] = Number(v) || 0;
  }
  return m;
}

/** コンテナ作成 */
export async function createContainer(userId, token, { text, mediaType = 'TEXT', imageUrl, videoUrl, replyToId, children }) {
  const params = { media_type: mediaType };
  if (text != null) params.text = text;
  if (imageUrl) params.image_url = imageUrl;
  if (videoUrl) params.video_url = videoUrl;
  if (replyToId) params.reply_to_id = replyToId;
  if (children) params.children = children.join(',');
  const r = await call(`/${userId}/threads`, { method: 'POST', token, params });
  return r.id;
}

/** カルーセルの子コンテナ */
export async function createCarouselItem(userId, token, { imageUrl, videoUrl }) {
  const params = { is_carousel_item: 'true', media_type: videoUrl ? 'VIDEO' : 'IMAGE' };
  if (imageUrl) params.image_url = imageUrl;
  if (videoUrl) params.video_url = videoUrl;
  const r = await call(`/${userId}/threads`, { method: 'POST', token, params });
  return r.id;
}

export async function getContainerStatus(containerId, token) {
  return call(`/${containerId}`, { token, params: { fields: 'id,status,error_message' } });
}

/** FINISHED まで 1 分ごとに最大 waitMinutes 分待つ */
export async function waitForContainer(containerId, token, { waitMinutes = 5, intervalMs = 60000 } = {}) {
  for (let i = 0; i <= waitMinutes; i++) {
    const s = await getContainerStatus(containerId, token);
    if (s.status === 'FINISHED') return s;
    if (s.status === 'ERROR' || s.status === 'EXPIRED') throw new Error(`コンテナが ${s.status}: ${s.error_message || ''}`);
    if (i < waitMinutes) await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('コンテナが時間内に FINISHED になりませんでした');
}

export async function publishContainer(userId, token, containerId) {
  const r = await call(`/${userId}/threads_publish`, { method: 'POST', token, params: { creation_id: containerId } });
  return r.id;
}

export async function deleteThread(threadId, token) {
  return call(`/${threadId}`, { method: 'DELETE', token });
}

/** 投稿の permalink など */
export async function getPermalink(threadId, token) {
  const r = await call(`/${threadId}`, { token, params: { fields: 'id,permalink' } });
  return r.permalink;
}

/** テキスト投稿を一発で出す（テスト用と返信用） */
export async function publishText(userId, token, text, { replyToId } = {}) {
  const cid = await createContainer(userId, token, { text, mediaType: 'TEXT', replyToId });
  // テキストだけでも作成直後は数秒待つのが安全
  await new Promise((r) => setTimeout(r, 3000));
  return publishContainer(userId, token, cid);
}

export const THREADS_SCOPES = SCOPES;
