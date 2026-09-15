'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { authenticate, signSession, cookieOptions, COOKIE_NAME } from '@/lib/server/auth.mjs';

export async function loginAction(prevState, formData) {
  const user = String(formData.get('user') || '').trim();
  const password = String(formData.get('password') || '');
  const next = String(formData.get('next') || '/');
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
