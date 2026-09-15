'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { findUser } from '@/lib/server/auth-core.mjs';
import { SESSION_COOKIE, createSession, cookieOptions } from '@/lib/server/session.mjs';

/** ログイン。成功したら元のページ（無ければ全体状況）へ進む。 */
export async function login(formData) {
  const name = String(formData.get('name') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '') || '/';

  if (!name || !password) return { error: 'IDとパスワードを入力してください。' };

  const user = findUser(name, password);
  if (!user) return { error: 'IDまたはパスワードが違います。' };

  const store = await cookies();
  store.set(SESSION_COOKIE, await createSession(user), cookieOptions());

  // 外部サイトへ飛ばされないよう、自サイト内のパスだけを受け付ける
  redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/');
}

/** ログアウト。クッキーを消してログイン画面へ戻す。 */
export async function logout() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect('/login');
}
