// Vercel Cron から呼ばれるトークン延長エンドポイント。週次で実行する。
import { refreshTokens } from '@/lib/server/tokens.mjs';
import { pruneOldRuns } from '@/lib/server/maintenance.mjs';
import { isAuthorizedCron } from '@/lib/server/cron-auth.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request) {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: '認可されていません。' }, { status: 401 });
  }
  try {
    const tokens = await refreshTokens({});
    // ついでに古い実行ログを片付ける（1日1回で十分）
    const pruned = await pruneOldRuns({});
    return Response.json({ ...tokens, pruned });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
