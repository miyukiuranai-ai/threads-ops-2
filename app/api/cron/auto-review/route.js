// 承認されなかった投稿を締切で仕分けるエンドポイント。
// 通常は投稿実行（5分おき）から締切の時間帯に呼ばれるので、
// ここは手動で回したいときと、外部のスケジューラから直接叩きたいとき用。
import { autoReviewPending, AUTO_REVIEW_AT, shouldRunNow } from '@/lib/server/auto-review.mjs';
import { isAuthorizedCron } from '@/lib/server/cron-auth.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request) {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: '認可されていません。' }, { status: 401 });
  }

  // ?force=1 が無ければ、締切の時間帯でないと何もしない。?dry=1 は書き換えずに結果だけ返す
  const params = new URL(request.url).searchParams;
  const force = params.get('force') === '1';
  const dry = params.get('dry') === '1';
  if (!force && !dry && !shouldRunNow()) {
    return Response.json({ skipped: true, at: AUTO_REVIEW_AT });
  }

  try {
    return Response.json(await autoReviewPending({ dry }));
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
