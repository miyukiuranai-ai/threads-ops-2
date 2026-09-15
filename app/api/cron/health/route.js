// 環境変数が読めているかの確認。値は出さず、有無と長さ・前後の空白や引用符の有無だけ。
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KEYS = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'FIREBASE_STORAGE_BUCKET', 'ANTHROPIC_API_KEY', 'ADMIN_USER', 'ADMIN_PASSWORD', 'MEMBERS', 'SESSION_SECRET', 'CRON_SECRET', 'POSTING_MODE', 'REPLY_MODE', 'THREADS_APP_ID', 'THREADS_APP_SECRET', 'THREADS_REDIRECT_URI'];

export async function GET() {
  const out = {};
  for (const k of KEYS) {
    const v = process.env[k];
    out[k] = v == null ? '未設定' : v === '' ? '空' : `${v.length}文字${/^\s|\s$/.test(v) ? ' 前後に空白あり' : ''}${/^["']|["']$/.test(v) ? ' 引用符つき' : ''}${/\r/.test(v) ? ' 改行コード混入' : ''}`;
  }
  const similar = Object.keys(process.env).filter((k) => /ADMIN|SESSION|CRON/i.test(k) && !KEYS.includes(k));
  return NextResponse.json({ ok: true, env: out, similarKeys: similar });
}
