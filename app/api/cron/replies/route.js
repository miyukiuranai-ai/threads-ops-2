// コメントの取得・判定・返信をまとめて行うエンドポイント。
// 外部の定期実行（Apps Script）から5分ごとに叩く想定。
//
// 読み取り量を抑えるため、取得と判定は15分に1回だけ動かす。
// 返信の送信は毎回行う（コメント受信から5〜30分の遅延があるので取りこぼさない）。
import { getDb, COLLECTIONS } from '@/lib/server/firebase.mjs';
import { collectRepliesForAccount, classifyPending, listRecentThreadsByAccount } from '@/lib/server/replies.mjs';
import { sendQueuedReplies } from '@/lib/server/send-replies.mjs';
import { isAuthorizedCron } from '@/lib/server/cron-auth.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** 取得を動かす間隔（分）。 */
const COLLECT_EVERY_MINUTES = 15;

export async function GET(request) {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: '認可されていません。' }, { status: 401 });
  }

  const startedAt = new Date().toISOString();
  const url = new URL(request.url);
  const force = url.searchParams.get('collect') === '1';
  const shouldCollect = force || new Date().getUTCMinutes() % COLLECT_EVERY_MINUTES < 5;

  const collected = [];
  let classified = null;

  try {
    const db = getDb();

    if (shouldCollect) {
      const accounts = (await db.collection(COLLECTIONS.accounts).get()).docs
        .map((d) => ({ id: d.id, ...d.data() }))
        // 停止中でも自動返信が ON なら取り込む（「投稿は手で、返信は自動」の使い方）
        .filter((a) => (a.status ?? 'active') === 'active' || a.autoReply === true);

      // 対象スレッドは全名義ぶんまとめて1回だけ問い合わせる
      const threadsByAccount = await listRecentThreadsByAccount();

      // 1名義の失敗が他を止めないようにする
      for (const account of accounts) {
        try {
          const r = await collectRepliesForAccount(account, threadsByAccount.get(account.id) ?? []);
          collected.push({ account: account.name, ...r });
        } catch (err) {
          collected.push({ account: account.name, error: err.message });
        }
      }

      classified = await classifyPending({});
    }

    const sent = await sendQueuedReplies({});

    return Response.json({ startedAt, collected: shouldCollect ? collected : 'skipped', classified, sent });
  } catch (err) {
    return Response.json({ error: err.message, startedAt, collected }, { status: 500 });
  }
}
