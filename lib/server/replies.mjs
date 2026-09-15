// コメントの取得・判定。送信は sendReplies.mjs 側。
// 方針:
//   - 基本は全員に返す。除外するのは「冷やかし・否定」と「被りが多い人」だけ
//   - 深夜に来たコメントには遅延謝罪のテンプレートを使う
import { getDb, COLLECTIONS } from './firebase.mjs';
import { HISTORY_COLLECTION } from './scoring.mjs';
import { listReplies, listMyThreads } from './threads.mjs';
import { generateText } from './claude.mjs';
import { getCursor, setCursor, touchCommenter, loadCommenters } from './reply-state.mjs';

/** 何時間前までの投稿を対象にするか（SPEC: 直近72h）。 */
const LOOKBACK_HOURS = 72;

/** 3文字以下は合言葉・絵文字だけとみなす。 */
const KEYWORD_MAX_CHARS = 3;

/**
 * 被り判定のしきい値。
 *
 * 同じ人が2名義以上に現れるのは本来おかしいので、既定は 2 のままにする。
 * ただし同じ人物設定を複数名義で回している期間は、届く層が重なって
 * 普通の人まで 2 に達してしまう。そのグループだけ環境変数で緩められるようにした。
 *   FARMER_ACCOUNTS_BY_GROUP="teamB:4"
 */
const FARMER = {
  accounts: Number(process.env.FARMER_ACCOUNTS ?? 2), // 既定: 2名義以上に出現
  posts: 3, // 全名義を通算して3投稿以上に出現（名義ごとではない）
};

/** グループごとの上書きを読む。"teamB:4,teamC:3" の形。 */
function farmerOverrides() {
  const map = new Map();
  for (const entry of String(process.env.FARMER_ACCOUNTS_BY_GROUP ?? '').split(',')) {
    const [group, value] = entry.split(':').map((x) => x?.trim());
    const n = Number(value);
    if (group && Number.isFinite(n) && n > 0) map.set(group, n);
  }
  return map;
}

/** そのグループでの「何名義以上なら被りとみなすか」。 */
export function farmerThreshold(group) {
  return farmerOverrides().get(group || 'main') ?? FARMER.accounts;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 日本時間の時（0-23）を返す。 */
export function jstHour(iso) {
  return new Date(new Date(iso).getTime() + 9 * 3600000).getUTCHours();
}

/** 深夜（2時〜6時）に来たコメントか。この時間帯は返信せず、朝に遅延謝罪で返す。 */
export function isNightComment(iso) {
  const h = jstHour(iso);
  return h >= 2 && h < 6;
}

/**
 * 直近72時間に投稿したスレッドを、全名義ぶんまとめて集める。
 * 名義ごとに全件を読み直すと読み取りが膨らむため、新しい順に少しだけ取る。
 */
export async function listRecentThreadsByAccount() {
  const db = getDb();
  const since = new Date(Date.now() - LOOKBACK_HOURS * 3600000).toISOString();

  const [postsSnap, histSnap] = await Promise.all([
    db.collection(COLLECTIONS.posts).orderBy('postedAt', 'desc').limit(40).get(),
    db.collection(HISTORY_COLLECTION).orderBy('timestamp', 'desc').limit(40).get(),
  ]);

  const byAccount = new Map();
  const add = (accountId, thread) => {
    if (!accountId || !thread.threadId) return;
    const list = byAccount.get(accountId) ?? new Map();
    list.set(thread.threadId, thread);
    byAccount.set(accountId, list);
  };

  for (const d of postsSnap.docs) {
    const p = d.data();
    if (p.status !== 'posted' || !p.postedThreadId) continue;
    if ((p.postedAt ?? '') < since) continue;
    add(p.accountId, { threadId: p.postedThreadId, postedAt: p.postedAt });
  }
  for (const d of histSnap.docs) {
    const h = d.data();
    if (!h.threadId || (h.timestamp ?? '') < since) continue;
    add(h.accountId, { threadId: h.threadId, postedAt: h.timestamp });
  }

  const result = new Map();
  for (const [accountId, list] of byAccount) result.set(accountId, [...list.values()]);
  return result;
}

/**
 * 手で投稿したスレッドも対象にするため、Threads API からその名義の直近の投稿を読んで足す。
 * ツールで出した投稿は posts に、夜中のインサイトで拾ったものは history にあるが、
 * 手で出した直後の投稿はどちらにも無く、コメントが翌朝まで拾えなかった（本人 9/12 うたで発覚）。
 * 名義ごとに1回だけ問い合わせる（15分に1回なので読み取りは軽い）。失敗しても既知の分だけで進める。
 */
export async function mergeOwnThreads(account, threads = []) {
  const known = new Map(threads.map((t) => [t.threadId, t]));
  if (!account.accessToken || !account.threadsUserId) return [...known.values()];
  const sinceMs = Date.now() - LOOKBACK_HOURS * 3600000;
  try {
    const res = await listMyThreads({
      accessToken: account.accessToken,
      userId: account.threadsUserId,
      limit: 25,
      since: Math.floor(sinceMs / 1000),
    });
    const db = getDb();
    for (const t of res.data ?? []) {
      if (!t?.id || known.has(t.id)) continue;
      if (t.timestamp && new Date(t.timestamp).getTime() < sinceMs) continue;
      known.set(t.id, { threadId: t.id, postedAt: t.timestamp ?? null, manual: true });
      // 表示数の「1時間後・3時間後」を取れるように、history に最小の記録を残す（数字は後で取り込む）
      try {
        await db.collection(HISTORY_COLLECTION).doc(t.id).set(
          { accountId: account.id, accountName: account.name, threadId: t.id, text: t.text ?? null, permalink: t.permalink ?? null, timestamp: t.timestamp ?? null, source: 'manual' },
          { merge: true }
        );
      } catch {
        // 残せなくてもコメントの取り込みは続ける
      }
    }
  } catch {
    // 問い合わせに失敗しても、posts / history にある分は取り込む
  }
  return [...known.values()];
}

/**
 * 1名義ぶんのコメントを取得して replies コレクションへ保存する。
 * 投稿ごとに「どこまで取り込んだか」を持ち、新しいコメントだけを書き込む。
 * 毎回すべてのコメントを読み直さないので、Firestore の読み取りが増えない。
 */
export async function collectRepliesForAccount(account, threadsForAccount = null) {
  const db = getDb();
  const threads = await mergeOwnThreads(account, threadsForAccount ?? (await listRecentThreadsByAccount()).get(account.id) ?? []);
  let fetched = 0;
  let added = 0;

  for (const thread of threads) {
    const cursor = await getCursor(thread.threadId);
    let newest = cursor;
    let after = null;

    for (let page = 0; page < 5; page += 1) {
      let res;
      try {
        res = await listReplies({
          accessToken: account.accessToken,
          threadId: thread.threadId,
          limit: 100,
          after,
        });
      } catch {
        break; // この投稿は諦めて次へ
      }

      const items = res.data ?? [];
      let sawNew = false;

      for (const c of items) {
        fetched += 1;
        if (c.is_reply_owned_by_me) continue;
        // 取り込み済みより古いものは触らない
        if (cursor && c.timestamp && c.timestamp <= cursor) continue;

        sawNew = true;
        if (!newest || (c.timestamp && c.timestamp > newest)) newest = c.timestamp;

        const text = String(c.text ?? '').trim();
        const hasText = [...text].length > KEYWORD_MAX_CHARS;

        await db.collection(COLLECTIONS.replies).doc(c.id).set({
          accountId: account.id,
          accountName: account.name,
          sourceThreadId: thread.threadId,
          replyId: c.id,
          username: c.username ?? null,
          text,
          mediaType: c.media_type ?? null, // TEXT_POST 以外（IMAGE/VIDEO/CAROUSEL_ALBUM）は画像つき
          charCount: [...text].length,
          category: hasText ? 'message' : 'keyword',
          timestamp: c.timestamp ?? null,
          arrivedAtNight: c.timestamp ? isNightComment(c.timestamp) : false,
          status: 'new',
          createdAt: new Date().toISOString(),
        });
        await touchCommenter({
          username: c.username,
          accountName: account.name,
          threadId: thread.threadId,
          hasText,
        });
        added += 1;
      }

      after = res.paging?.cursors?.after;
      // 1ページ丸ごと取り込み済みだったら、それ以上さかのぼらない
      if (!after || !items.length || (cursor && !sawNew)) break;
      await sleep(150);
    }

    if (newest && newest !== cursor) await setCursor(thread.threadId, newest);
  }

  return { threads: threads.length, fetched, added };
}

/** 被りが多いユーザーか。しきい値はその名義のグループで決まる。 */
export function isFarmer(stat, group = null) {
  if (!stat) return false;
  return (
    (stat.accounts?.length ?? 0) >= farmerThreshold(group) ||
    (stat.threads?.length ?? 0) >= FARMER.posts
  );
}

const CLASSIFY_SYSTEM = `あなたは日本語のコメントを判定する分類器です。
占い・霊視アカウントの投稿に付いたコメントを、次の3つに分類します。

- normal … 鑑定を希望している、挨拶、願い事、感謝、悩みの相談、絵文字や合言葉だけ
- negative … 否定、批判、疑い、揶揄、皮肉、冷やかし、能力を試す挑発
- spam … 宣伝、勧誘、無関係なURL、明らかな業者

negative の実例（これらは必ず negative）:
- 「霊感商法は詐欺」… 直接的な批判
- 「紹介でしか鑑定しなかったのに、SNSに現れたのは、紹介だけじゃお金稼ぎできないからですか？」… 矛盾を突く皮肉
- 「3年後の日本がどうなってるのか？ここで話してもらいたい」… 公開の場で証明を求める挑発
- 「そもそも自分の未来が見えてなくない？」… 反語による揶揄
- 「当ててみてください」「本当なら◯◯を言い当てて」… 力試し
- 「宗教ですか？」「怪しい」「胡散臭い」… 疑いの表明

判定のこつ:
- 疑問形でも、鑑定を依頼する意思がなく「証明させよう」としているものは negative
- 本人の悩みや願いを書いているものは、内容が重くても normal
- 「お願いします」「視てほしい」など依頼の意思があるものは normal
- 相手をからかう調子、当てこすり、鼻で笑う語尾は negative

判断がつかない場合は normal にしてください。

出力は必ず次のJSON形式のみ。
{"results":[{"id":"入力のid","verdict":"normal|negative|spam"}]}`;

/** 文章のあるコメントをまとめて判定する。 */
export async function classifyComments(comments) {
  if (!comments.length) return new Map();

  const list = comments
    .map((c, i) => `${i + 1}. id=${c.id} 「${String(c.text).replace(/\n/g, ' ').slice(0, 120)}」`)
    .join('\n');

  const { text } = await generateText({
    system: CLASSIFY_SYSTEM,
    messages: [{ role: 'user', content: `次の${comments.length}件を分類してください。\n\n${list}` }],
    maxTokens: 4000,
    effort: 'low',
  });

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const parsed = JSON.parse(text.slice(start, end + 1).replace(/\\(?!["\\/bfnrtu])/g, ''));

  const map = new Map();
  for (const r of parsed.results ?? []) map.set(String(r.id), r.verdict);
  return map;
}

/**
 * 未判定のコメントを判定し、返信対象かどうかを確定させる。
 * status: new → queued（返信する） / skipped（返信しない）
 */
export async function classifyPending({ limit = 200 } = {}) {
  const db = getDb();
  // 未判定のものだけを問い合わせる（コレクション全体は読まない）
  const snap = await db
    .collection(COLLECTIONS.replies)
    .where('status', '==', 'new')
    .limit(limit)
    .get();

  const pending = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!pending.length) return { classified: 0, queued: 0, skipped: 0 };

  // 判定に必要なユーザーぶんだけ集計を読む
  const stats = await loadCommenters(pending.map((r) => r.username));

  // 被りのしきい値は名義のグループで変わるので、名義の一覧を1回だけ読む
  const accountsSnap = await db.collection(COLLECTIONS.accounts).select('group').get();
  const groupOf = new Map(accountsSnap.docs.map((d) => [d.id, d.data().group ?? 'main']));

  // 文章のあるものだけAIで判定する（合言葉だけのものは判定不要）
  const needsAi = pending.filter((r) => r.category === 'message');
  const verdicts = new Map();
  for (let i = 0; i < needsAi.length; i += 40) {
    const chunk = needsAi.slice(i, i + 40);
    const res = await classifyComments(chunk);
    for (const [k, v] of res) verdicts.set(k, v);
  }

  // 冷やかし・宣伝と判定した人は、同じ名義への他のコメントにも返さない。
  // 「詐欺パトロール」のあとに画像だけを付けてくる、といった二段構えを弾くため。
  // 過去に弾いた人（直近分）と、今回の判定で弾く人を合わせる
  const hecklers = new Set();
  const pastSnap = await db
    .collection(COLLECTIONS.replies)
    .where('verdict', 'in', ['negative', 'spam'])
    .limit(500)
    .get();
  for (const d of pastSnap.docs) {
    const p = d.data();
    if (p.username) hecklers.add(`${p.accountId}::${p.username}`);
  }
  for (const r of pending) {
    const v = verdicts.get(r.id);
    if ((v === 'negative' || v === 'spam') && r.username) hecklers.add(`${r.accountId}::${r.username}`);
  }

  let queued = 0;
  let skipped = 0;

  for (const r of pending) {
    const verdict = verdicts.get(r.id) ?? 'normal';
    const imageOnly = !String(r.text ?? '').trim() && r.mediaType && r.mediaType !== 'TEXT_POST';
    const emptyComment = !String(r.text ?? '').trim();
    const knownHeckler = r.username && hecklers.has(`${r.accountId}::${r.username}`) && verdict !== 'negative' && verdict !== 'spam';
    const stat = stats.get(r.username);
    const group = groupOf.get(r.accountId) ?? 'main';
    const farmer = isFarmer(stat, group);

    let status = 'queued';
    let skipReason = null;

    if (verdict === 'negative') {
      status = 'skipped';
      skipReason = '否定的・冷やかし';
    } else if (knownHeckler) {
      status = 'skipped';
      skipReason = '冷やかし・宣伝と判定した人の別コメント';
    } else if (imageOnly || emptyComment) {
      status = 'skipped';
      skipReason = imageOnly ? '画像・動画だけのコメント' : '本文が無いコメント';
    } else if (verdict === 'spam') {
      status = 'skipped';
      skipReason = '宣伝・勧誘';
    } else if (farmer) {
      status = 'skipped';
      skipReason = `被りが多い（${stat.accounts.length}名義 / ${stat.threads.length}投稿・${group}は${farmerThreshold(group)}名義から除外）`;
    }

    await db.collection(COLLECTIONS.replies).doc(r.id).set(
      { status, verdict, skipReason, classifiedAt: new Date().toISOString() },
      { merge: true }
    );

    if (status === 'queued') queued += 1;
    else skipped += 1;
  }

  return { classified: pending.length, queued, skipped };
}
