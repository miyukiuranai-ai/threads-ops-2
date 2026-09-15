// 承認済みかつ予定時刻を過ぎた投稿を Threads へ送る。
// 投稿してよいかの判定は必ず guard.mjs を通す。
// 1名義の失敗が他名義を止めないよう、アカウント単位で例外を閉じ込める（SPEC のエラー隔離）。
import { getDb, COLLECTIONS } from './firebase.mjs';
import { checkPostingAllowed, postingMode } from './guard.mjs';
import {
  createTextContainer,
  createMediaContainer,
  createCarouselContainer,
  waitForContainer,
  publishContainer,
  getThread,
} from './threads.mjs';
import { attachedMedia, signedUrl, MEDIA_LIMITS } from './storage.mjs';
import { needsImage } from './image-need.mjs';
import { LATE_LIMIT_MINUTES, alignBodyTime, jstClock, minutesLate } from './post-time.mjs';

/** コンテナ作成から公開までの待ち時間（公式推奨は約30秒）。 */
const PUBLISH_DELAY_MS = 30_000;

/**
 * 取りかかった投稿を他の実行が触らないようにする印。
 * 投稿は公開まで30秒ほどかかるため、印を付けずに進めると
 * 同時に走った実行が同じ投稿を二重に公開してしまう。
 */
const CLAIM_STATUS = 'publishing';

/** 途中で落ちた印を、この時間が過ぎたら解放する。 */
const CLAIM_TIMEOUT_MS = 10 * 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * この投稿の担当権を取る。
 * 取れたら true。他の実行が既に取っていたら false。
 */
async function claimPost(db, postId) {
  const ref = db.collection(COLLECTIONS.posts).doc(postId);
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;

      const post = snap.data();
      if (post.status === CLAIM_STATUS) {
        // 途中で落ちた可能性がある。十分に古ければ引き取る
        const age = Date.now() - new Date(post.claimedAt ?? 0).getTime();
        if (age < CLAIM_TIMEOUT_MS) return false;
      } else if (post.status !== 'approved') {
        return false;
      }

      tx.set(ref, { status: CLAIM_STATUS, claimedAt: new Date().toISOString() }, { merge: true });
      return true;
    });
  } catch {
    return false;
  }
}

/** 実行ログを1件残す。 */
async function recordRun(db, run) {
  await db.collection(COLLECTIONS.runs).add({
    job: 'publish',
    ...run,
    finishedAt: new Date().toISOString(),
  });
}

/**
 * 予定時刻を過ぎた承認済み投稿を投稿する。
 * @param {object} opts
 * @param {number} [opts.delayMs] コンテナ作成後の待機時間。テスト時は短縮できる
 * @param {boolean} [opts.force] ガードの dry_run を無視して実際に投稿する
 */
export async function publishDuePosts({ delayMs = PUBLISH_DELAY_MS, force = false } = {}) {
  const db = getDb();
  const startedAt = new Date().toISOString();
  const nowIso = startedAt;

  const accountsSnap = await db.collection(COLLECTIONS.accounts).get();
  const accounts = accountsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // 承認済みの投稿は1回だけ問い合わせ、名義ごとの絞り込みは手元で行う
  const approvedSnap = await db
    .collection(COLLECTIONS.posts)
    .where('status', '==', 'approved')
    .limit(200)
    .get();
  const approved = approvedSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const results = [];

  for (const account of accounts) {
    try {
      const due = approved
        .filter((p) => p.accountId === account.id)
        .filter((p) => p.scheduledAt && p.scheduledAt <= nowIso)
        .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

      if (!due.length) continue;

      const guard = checkPostingAllowed(account);
      if (!guard.allowed) {
        for (const post of due) {
          results.push({ account: account.name, postId: post.id, result: 'skipped', reason: guard.reason });
        }
        continue;
      }

      for (const post of due) {
        // 遅れすぎた投稿は出さない。
        // 「午前4時48分。」と書かれた投稿が昼過ぎに出てしまうのを防ぐ。
        // 予定時刻を過ぎてから承認したときに起きる。
        const late = minutesLate(post.scheduledAt);
        if (late > LATE_LIMIT_MINUTES) {
          await db.collection(COLLECTIONS.posts).doc(post.id).set(
            {
              status: 'missed',
              missedAt: new Date().toISOString(),
              missedReason: `予定時刻から${late}分過ぎているため見送りました`,
            },
            { merge: true }
          );
          results.push({
            account: account.name,
            postId: post.id,
            result: 'missed',
            reason: `予定 ${post.slot ?? '-'} から${late}分遅れ。時刻を直して出し直してください`,
          });
          continue;
        }

        // 同時に走った実行と取り合いにならないよう、先に担当権を取る
        if (!(await claimPost(db, post.id))) {
          results.push({
            account: account.name,
            postId: post.id,
            result: 'skipped',
            reason: '他の実行が処理中です',
          });
          continue;
        }

        // 本文が画像を指している投稿だけ、素材が揃うまで止める。
        // 画像の指示が付いていても、本文だけで読めるものはそのまま出す
        const media = attachedMedia(post);
        if (!media.length && needsImage(post)) {
          await db.collection(COLLECTIONS.posts).doc(post.id).set(
            { status: 'held', holdReason: '画像が未準備', reviewedAt: new Date().toISOString() },
            { merge: true }
          );
          results.push({
            account: account.name,
            postId: post.id,
            result: 'held',
            reason: '本文が画像を指しているため保留にしました',
          });
          continue;
        }

        if (guard.dryRun && !force) {
          await db.collection(COLLECTIONS.posts).doc(post.id).set(
            { status: 'posted', dryRun: true, postedAt: new Date().toISOString() },
            { merge: true }
          );
          results.push({
            account: account.name,
            postId: post.id,
            result: 'dry_run',
            reason: 'POSTING_MODE=dry_run のため実際には投稿していません',
            body: post.body,
          });
          continue;
        }

        // 本文の冒頭に時刻が書かれていれば、いま投稿する時刻に合わせる。
        // ジッター（±3〜10分）のぶんのズレをここで吸収する。
        const aligned = alignBodyTime(post.body, jstClock());
        const body = aligned.body;

        try {
          let containerId;
          try {
            containerId = await buildContainer({ account, text: body, media, delayMs });
          } catch (err) {
            // 画像つきは Threads 側が画像を取りに来る途中で一時的に失敗することがある（9/13 未明に2件。同じ画像で直後に成功）。
            // 一度だけ少し待って作り直す。それでもだめなら失敗として記録する
            if (!media.length) throw err;
            await sleep(10_000);
            containerId = await buildContainer({ account, text: body, media, delayMs });
          }
          const published = await publishContainer({
            accessToken: account.accessToken,
            userId: account.threadsUserId,
            creationId: containerId,
          });

          let permalink = null;
          try {
            const thread = await getThread({ accessToken: account.accessToken, threadId: published.id });
            permalink = thread.permalink ?? null;
          } catch {
            // permalink が取れなくても投稿自体は成功している
          }

          await db.collection(COLLECTIONS.posts).doc(post.id).set(
            {
              status: 'posted',
              dryRun: false,
              body,
              timeAligned: aligned.changed ? `${aligned.from} → ${jstClock()}` : null,
              postedThreadId: published.id,
              permalink,
              postedAt: new Date().toISOString(),
            },
            { merge: true }
          );
          results.push({ account: account.name, postId: post.id, result: 'posted', threadId: published.id, permalink });
        } catch (err) {
          await db.collection(COLLECTIONS.posts).doc(post.id).set(
            { status: 'failed', error: err.message, failedAt: new Date().toISOString() },
            { merge: true }
          );
          results.push({ account: account.name, postId: post.id, result: 'failed', reason: err.message });
        }
      }
    } catch (err) {
      // この名義の処理だけを諦め、次の名義へ進む
      results.push({ account: account.name, result: 'failed', reason: err.message });
    }
  }

  const summary = results.reduce((acc, r) => {
    acc[r.result] = (acc[r.result] ?? 0) + 1;
    return acc;
  }, {});

  // 何も起きなかった回はログを残さない（件数が増えすぎるため）
  if (!results.length) return { startedAt, mode: postingMode(), summary, results };

  await recordRun(db, {
    startedAt,
    mode: postingMode(),
    status: results.some((r) => r.result === 'failed') ? 'failed' : 'ok',
    summary,
    message: results
      .filter((r) => r.result === 'failed')
      .map((r) => `${r.account}: ${r.reason}`)
      .join(' / '),
    results,
  });

  return { startedAt, mode: postingMode(), summary, results };
}

/**
 * 投稿の中身に合わせてコンテナを組み立て、公開できる状態になるまで待つ。
 *
 *   素材なし   TEXT
 *   1つ        IMAGE / VIDEO
 *   2つ以上    子を作ってから CAROUSEL（2〜20）
 */
async function buildContainer({ account, text, media, delayMs }) {
  const accessToken = account.accessToken;
  const userId = account.threadsUserId;

  if (!media.length) {
    const container = await createTextContainer({ accessToken, userId, text });
    await sleep(delayMs);
    return container.id;
  }

  if (media.length > MEDIA_LIMITS.carousel.max) {
    throw new Error(`素材は${MEDIA_LIMITS.carousel.max}個までです（いまは${media.length}個）。`);
  }

  // 期限つきURLを作って渡す。バケットは公開しない
  const urls = await Promise.all(media.map((m) => (m.url ? m.url : signedUrl(m.path))));
  const hasVideo = media.some((m) => m.kind === 'video');

  let containerId;
  if (media.length === 1) {
    const container = await createMediaContainer({
      accessToken,
      userId,
      kind: media[0].kind,
      url: urls[0],
      text,
    });
    containerId = container.id;
  } else {
    const children = [];
    for (const [i, m] of media.entries()) {
      const child = await createMediaContainer({
        accessToken,
        userId,
        kind: m.kind,
        url: urls[i],
        isCarouselItem: true,
      });
      children.push(child.id);
    }
    const container = await createCarouselContainer({
      accessToken,
      userId,
      childIds: children,
      text,
    });
    containerId = container.id;
  }

  // 公式の案内どおり、公開前に少し待ってから状態を確かめる
  await sleep(delayMs);
  await waitForContainer({
    accessToken,
    containerId,
    intervalMs: hasVideo ? 60_000 : 15_000,
  });

  return containerId;
}
