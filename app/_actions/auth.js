'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { authenticate, signSession, cookieOptions, COOKIE_NAME } from '@/lib/server/auth.mjs';
import { listUsers, env } from '@/lib/server/env.mjs';

export async function loginAction(prevState, formData) {
  const user = String(formData.get('user') || '').trim();
  const password = String(formData.get('password') || '');
  const next = String(formData.get('next') || '/');
  if (!listUsers().length) return { error: 'サーバーに ADMIN_PASSWORD（と ADMIN_USER）が設定されていません。Vercel の Environment Variables に入れて Redeploy してください。' };
  if (!env.SESSION_SECRET) return { error: 'サーバーに SESSION_SECRET が設定されていません。' };
  const payload = authenticate(user, password);
  if (!payload) return { error: 'ID かパスワードが違います' };
  const token = await signSession(payload);
  const store = await cookies();
  store.set(COOKIE_NAME, token, cookieOptions());
  redirect(next.startsWith('/') ? next : '/');
}

export async function logoutAction() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
  redirect('/login');
}
