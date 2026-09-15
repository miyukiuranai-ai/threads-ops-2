// ログインと署名付きクッキー。Web Crypto だけを使うので Edge（middleware）でも動く。
import { env, listUsers } from './env.mjs';

export const COOKIE_NAME = 'to2_session';
const COOKIE_DAYS = 30;

const enc = new TextEncoder();

function b64url(bytes) {
  let s = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return b64url(sig);
}

function secret() {
  const s = env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET（または CRON_SECRET / ADMIN_PASSWORD）が未設定です');
  return s;
}

/** セッション文字列を作る。payload = {user, role, group, exp} */
export async function signSession(payload) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await hmac(secret(), body);
  return `${body}.${sig}`;
}

export async function verifySession(token) {
  if (!token || typeof token !== 'string') return null;
  const idx = token.lastIndexOf('.');
  if (idx < 0) return null;
  const body = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  let expected;
  try { expected = await hmac(secret(), body); } catch { return null; }
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

/** ID とパスワードの照合。合えば payload を返す */
export function authenticate(user, password) {
  const found = listUsers().find((u) => u.user === user && u.password === password);
  if (!found) return null;
  return {
    user: found.user,
    role: found.role,
    group: found.group,
    exp: Date.now() + COOKIE_DAYS * 86400000,
  };
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_DAYS * 86400,
  };
}

/** 定期実行の認可。Authorization: Bearer か ?key= */
export function checkCronKey(request) {
  const s = env.CRON_SECRET;
  if (!s) return false;
  const auth = request.headers.get('authorization') || '';
  if (auth === `Bearer ${s}`) return true;
  try {
    const url = new URL(request.url);
    if (url.searchParams.get('key') === s) return true;
  } catch { /* noop */ }
  return false;
}

/** この利用者がこの名義を見てよいか */
export function canSeeAccount(session, account) {
  if (!session) return false;
  if (session.role === 'admin') return true;
  return (account?.group || 'main') === (session.group || 'main');
}
