// Vercel Cron から呼ばれる投稿案の生成エンドポイント。1日1回、翌日ぶんを作る。
//
// 生成の前に、昨日の成績のレポートを作る。
// レポートで出た「続けること」「やめること」を、その日の生成に渡すため。
// 分析が投稿に効かないと意味がないので、この順番を崩さないこと。
import { generateDaily } from '@/lib/server/pipeline.mjs';
import { generateDailyReport } from '@/lib/server/report.mjs';
import { isAuthorizedCron } from '@/lib/server/cron-auth.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request) {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: '認可されていません。' }, { status: 401 });
  }

  try {
    let report = null;
    try {
      report = await generateDailyReport({});
    } catch (err) {
      // レポートが作れなくても生成は止めない
      report = { error: err.message };
    }

    const generated = await generateDaily({});
    return Response.json({ ...generated, report });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
