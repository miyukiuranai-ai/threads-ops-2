// 相談。1 往復ごとに API の費用がかかる。
import { NextResponse } from 'next/server';
import { getSession } from '@/app/_lib/session';
import { chat } from '@/lib/server/chat.mjs';
import { withRun } from '@/lib/server/runs.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const text = String(body.text || '').trim();
  if (!text) return NextResponse.json({ error: '本文が空です' }, { status: 400 });
  try {
    const r = await withRun('chat', async (results) => {
      const out = await chat({ text, session, model: body.model });
      results.push({ user: session.user, usage: out.usage });
      return { message: '相談', usage: out.usage };
    }, { by: session.user });
    return NextResponse.json({ ok: true, runId: r.runId });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
