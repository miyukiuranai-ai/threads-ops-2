// レポートの返事ボタン。指示を保存して翌日ぶんを作り直す。
import { NextResponse } from 'next/server';
import { getSession } from '@/app/_lib/session';
import { canSeeAccount } from '@/lib/server/auth.mjs';
import { resolveAccount } from '@/lib/server/accounts.mjs';
import { setDirective } from '@/lib/server/directives.mjs';
import { generateForAccount } from '@/lib/server/pipeline.mjs';
import { withRun } from '@/lib/server/runs.mjs';
import { jstDate, addDays } from '@/lib/server/time.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const acc = await resolveAccount(body.account);
  if (!acc || !canSeeAccount(session, acc)) return NextResponse.json({ error: '名義が見つかりません' }, { status: 404 });
  const date = body.date || addDays(jstDate(), 1);
  const action = body.action || 'keep';
  try {
    const r = await withRun('directive', async (results) => {
      await setDirective({ accountId: acc.id, date, action, types: body.types || [], instruction: body.instruction || '', setBy: session.user });
      const gen = await generateForAccount(acc, { date, force: true, generatedBy: `directive:${session.user}` });
      results.push(gen);
      return { message: `${acc.name} ${date} ${action}`, usage: gen.usage };
    }, { by: session.user });
    return NextResponse.json({ ok: true, account: acc.name, date, action, result: r.results[0] });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
