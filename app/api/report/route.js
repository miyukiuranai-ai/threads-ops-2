// レポートの作り直し。ログインクッキーで認可（middleware）。
import { NextResponse } from 'next/server';
import { getSession } from '@/app/_lib/session';
import { generateReport } from '@/lib/server/report.mjs';
import { withRun } from '@/lib/server/runs.mjs';
import { jstDate, addDays } from '@/lib/server/time.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const date = body.date || addDays(jstDate(), -1);
  try {
    const r = await withRun('report', async (results) => {
      const rep = await generateReport(date);
      results.push({ date, alerts: (rep.alerts || []).length });
      return { message: `レポート ${date}`, usage: rep.usage };
    }, { by: session.user });
    return NextResponse.json({ ok: true, date, runId: r.runId });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
