// ログイン状態を持ち回すための署名付きクッキー。
//
// Basic 認証はブラウザが ID とパスワードを覚えてしまい、ログアウトができない。
// そこでログイン画面 + クッキーに切り替えた。改ざんされていないことは HMAC で確かめる。
//
// middleware（Edge）と画面（Node）の両方から読むため、Web Crypto だけで書いている。

export const SESSION_COOKIE = 'tool_session';

/** ログインの有効期間。 */
export const SESSION_DAYS = 30;

const encoder = new TextEncoder();

/** 署名に使う鍵。専用のものが無ければ既存の秘密を流用する（環境変数を増やさない）。 */
function secret() {
  const value =
    process.env.SESSION_SECRET || process.env.CRON_SECRET || process.env.ADMIN_PASSWORD;
  if (!value) throw new Error('セッションの署名鍵がありません（SESSION_SECRET を設定してください）。');
  return value;
}

function toBase64Url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(text) {
  const normalized = text.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function sign(payload) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return toBase64Url(new Uint8Array(mac));
}

/** 利用者からクッキーの値を作る。 */
export async function createSession(user) {
  const body = {
    n: user.name,
    r: user.role,
    g: user.group ?? '',
    e: Date.now() + SESSION_DAYS * 86400000,
  };
  const payload = toBase64Url(encoder.encode(JSON.stringify(body)));
  return `${payload}.${await sign(payload)}`;
}

/** クッキーの値から利用者を取り出す。壊れていれば null。 */
export async function readSession(value) {
  if (!value || typeof value !== 'string') return null;

  const dot = value.lastIndexOf('.');
  if (dot < 1) return null;

  const payload = value.slice(0, dot);
  const signature = value.slice(dot + 1);

  let expected;
  try {
    expected = await sign(payload);
  } catch {
    return null;
  }
  if (signature.length !== expected.length) return null;

  // 長さが同じときは1文字ずつ比べる（早期に抜けない）
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) return null;

  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
  } catch {
    return null;
  }

  if (!body?.n || !body?.e || Date.now() > body.e) return null;

  const role = body.r === 'admin' ? 'admin' : 'member';
  return { name: body.n, role, group: role === 'admin' ? null : body.g || null };
}

/** クッキーに付ける共通の設定。 */
export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  };
}
