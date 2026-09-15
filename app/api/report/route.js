// 画面の「いま作り直す」から日次レポートを作るためのエンドポイント。
//
// サーバーアクションではなく API にしている理由:
//   Claude の呼び出しに30〜60秒かかり、既定の実行上限に収まらないため。
// ログイン中の利用者だけが呼べる（middleware がクッキーを確かめる）。
import { getCurrentUser } from '@/lib/server/auth.mjs';
import { generateDailyReport } from '@/lib/server/report.mjs';
import { jstDate } from '@/lib/server/signups.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user?.name) {
    return Response.json({ error: 'ログインが必要です。' }, { status: 401 });
  }

  let date = null;
  try {
    const body = await request.json();
    if (body?.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) date = body.date;
  } catch {
    // 本文なしなら昨日ぶん
  }
  if (date && date >= jstDate()) {
    return Response.json({ error: '今日より前の日付を選んでください（反応は翌日に集計されます）。' }, { status: 400 });
  }

  try {
    const report = await generateDailyReport({ date });
    return Response.json({ ok: true, date: report.date, skipped: report.skipped ?? null });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
