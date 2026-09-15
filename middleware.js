// 認証。ログイン画面と定期実行の入口以外は署名付きクッキーが要る。Edge で動く。
import { NextResponse } from 'next/server';
import { verifySession, COOKIE_NAME } from './lib/server/auth.mjs';

export async function middleware(request) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith('/api/cron/')) return NextResponse.next();
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const session = await verifySession(token);
  if (pathname === '/login') {
    if (session) return NextResponse.redirect(new URL('/', request.url));
    return NextResponse.next();
  }
  if (!session) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
    const url = new URL('/login', request.url);
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  const res = NextResponse.next();
  res.headers.set('x-to2-user', encodeURIComponent(session.user));
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt).*)'],
};
