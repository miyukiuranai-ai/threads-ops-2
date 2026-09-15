// Cron エンドポイントの認可。CRON_SECRET を知っているリクエストだけ通す。
//
// 2通りの渡し方に対応する:
//   1. Authorization: Bearer <CRON_SECRET>   … Vercel Cron / GitHub Actions など
//   2. ?key=<CRON_SECRET>                    … ヘッダを設定できない外部の定期実行サービス用
export function isAuthorizedCron(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  if (request.headers.get('authorization') === `Bearer ${secret}`) return true;

  try {
    return new URL(request.url).searchParams.get('key') === secret;
  } catch {
    return false;
  }
}
