// 定期実行の入口: refresh-tokens。CRON_SECRET で認可（Authorization: Bearer か ?key=）。
import { NextResponse } from 'next/server';
import { checkCronKey } from '@/lib/server/auth.mjs';
import { jobRefreshTokens } from '@/lib/server/cron-jobs.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function handle(request) {
  if (!checkCronKey(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const url = new URL(request.url);
    const opts = {};
    if (url.searchParams.get('date')) opts.date = url.searchParams.get('date');
    if (url.searchParams.get('collect')) opts.forceCollect = true;
    const r = await jobRefreshTokens(opts);
    return NextResponse.json({ ok: true, runId: r.runId, message: r.message, results: r.results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
