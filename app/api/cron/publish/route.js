// 投稿実行エンドポイント。5分おきに呼ばれ、承認済みかつ予定時刻を過ぎた投稿を送る。
//
// 締切（既定 23:30）の時間帯に当たったときは、承認されないまま残っている
// 投稿の仕分けもここで行う。Vercel の無料枠は1日1回の Cron しか置けないため、
// 5分おきに動いているこの経路に相乗りさせている。
import { publishDuePosts } from '@/lib/server/publish.mjs';
import { autoReviewPending, shouldRunNow } from '@/lib/server/auto-review.mjs';
import { collectInsights, shouldCollectNow } from '@/lib/server/insights.mjs';
import { isAuthorizedCron } from '@/lib/server/cron-auth.mjs';
import { autoDeleteFlops } from '@/lib/server/auto-delete.mjs';
import { takeSnapshots } from '@/lib/server/impressions.mjs';
import { switchUpcomingPosts, autoApproveSwitched } from '@/lib/server/per-post.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request) {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: '認可されていません。' }, { status: 401 });
  }

  try {
    // 仕分けを先に済ませてから投稿する（承認された直後の分もその回で拾える）
    let autoReview = null;
    if (shouldRunNow()) {
      try {
        autoReview = await autoReviewPending();
      } catch (err) {
        // 仕分けに失敗しても投稿は止めない
        autoReview = { error: err.message };
      }
    }

    // 投稿ごとの切り替えで作り直した1本が投稿時刻を迎えていれば、自動で承認してから投稿する
    let autoApproved = null;
    try {
      const r = await autoApproveSwitched();
      if (r.approved || r.waiting) autoApproved = r;
    } catch (err) {
      autoApproved = { error: err.message };
    }

    const result = await publishDuePosts();

    // これから2時間以内に出る投稿を、直前の投稿の3時間後の判定と見比べ、段が違えばその1本だけ作り直す
    let switched = null;
    try {
      const r = await switchUpcomingPosts();
      if (r.checked || r.switched || r.errors.length) switched = r;
    } catch (err) {
      switched = { error: err.message };
    }

    // 反応の取り込みも、1日1回この経路で回す
    let insights = null;
    if (shouldCollectNow()) {
      try {
        insights = await collectInsights();
      } catch (err) {
        insights = { error: err.message };
      }
    }

    // 投稿の1時間後・3時間後の表示数を取り、良い・悪いを付ける（全名義共通の線）。毎回、該当が出た分だけ
    let snapshots = null;
    try {
      const r = await takeSnapshots();
      if (r.checked || r.errors.length) snapshots = r;
    } catch (err) {
      snapshots = { error: err.message };
    }

    // 伸びなかったバズ型の自動削除（24時間で反応0）。毎回、該当が出た分だけ
    let flops = null;
    try {
      const r = await autoDeleteFlops();
      if (r.checked || r.errors.length) flops = r;
    } catch (err) {
      flops = { error: err.message };
    }

    return Response.json({
      ...result,
      ...(autoReview ? { autoReview } : {}),
      ...(insights ? { insights } : {}),
      ...(flops ? { flops } : {}),
      ...(snapshots ? { snapshots } : {}),
      ...(autoApproved ? { autoApproved } : {}),
      ...(switched ? { switched } : {}),
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
