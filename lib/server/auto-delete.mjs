// 伸びなかったバズ型の自動削除。
// バズ型は当たらなければ意味がなく、残しておくと名義の見た目を薄くする（本人の方針）。
// 投稿から24時間たった時点で、いいねもコメントも0なら Threads から消す。
// 属人型・霊視開始型・除外フック型は資産として残す。名義ごとに OFF にできる（persona.autoDeleteFlops）。
import { getDb, COLLECTIONS } from './firebase.mjs';
import { getThreadInsights } from './threads.mjs';
import { deletePostedPost } from './post-delete.mjs';

const HOURS = 3600000;
const CHECK_AFTER_HOURS = 24; // これより前には判定しない
const CHECK_UNTIL_HOURS = 72; // これより古いものは触らない（取りこぼしは手で）
const TARGET_TYPES = new Set(['buzz_engagement']);

/** インサイトの返り値から いいね・コメント を取り出す。 */
function pickCounts(res) {
  const out = { likes: null, replies: null };
  for (const m of res?.data ?? []) {
    const v = Array.isArray(m.values) ? m.values[0]?.value : m.total_value?.value;
    if (m.name === 'likes') out.likes = Number(v ?? 0);
    if (m.name === 'replies') out.replies = Number(v ?? 0);
  }
  return out;
}

/**
 * 判定して消す。5分おきの経路から呼ぶ。1回に見るのは数件なので軽い。
 * @returns {{ checked: number, deleted: string[], kept: string[], errors: string[] }}
 */
export async function autoDeleteFlops({ now = Date.now(), dry = false, log = () => {} } = {}) {
  const db = getDb();
  const result = { checked: 0, deleted: [], kept: [], errors: [] };

  const [postsSnap, accSnap, personaSnap] = await Promise.all([
    db.collection(COLLECTIONS.posts).where('status', '==', 'posted').get(),
    db.collection(COLLECTIONS.accounts).get(),
    db.collection(COLLECTIONS.personas).get(),
  ]);
  const accounts = new Map(accSnap.docs.map((d) => [d.id, d.data()]));
  const personas = new Map(personaSnap.docs.map((d) => [d.id, d.data()]));

  const candidates = postsSnap.docs
    .map((d) => ({ id: d.id, ref: d.ref, ...d.data() }))
    .filter((p) => TARGET_TYPES.has(p.type) && p.postedThreadId && p.postedAt && !p.flopChecked)
    .filter((p) => {
      const age = (now - Date.parse(p.postedAt)) / HOURS;
      return age >= CHECK_AFTER_HOURS && age <= CHECK_UNTIL_HOURS;
    })
    .slice(0, 10);

  for (const p of candidates) {
    const account = accounts.get(p.accountId);
    const persona = personas.get(account?.personaId ?? '');
    if (!account?.accessToken) continue;
    if (persona?.autoDeleteFlops === false) {
      await p.ref.set({ flopChecked: true, flopResult: 'skipped（名義の設定でOFF）' }, { merge: true });
      continue;
    }
    result.checked += 1;
    try {
      const res = await getThreadInsights({ accessToken: account.accessToken, threadId: p.postedThreadId, metrics: 'likes,replies' });
      const { likes, replies } = pickCounts(res);
      const flop = likes === 0 && replies === 0;
      if (dry) {
        result[flop ? 'deleted' : 'kept'].push(`（試し）@${p.accountName} いいね${likes} コメント${replies} ${String(p.body).split('\n')[0].slice(0, 20)}`);
        continue;
      }
      if (flop) {
        await deletePostedPost({ postId: p.id, by: '自動（24時間で反応0のバズ型）' });
        await p.ref.set({ flopChecked: true, flopResult: 'deleted', flopCounts: { likes, replies } }, { merge: true });
        result.deleted.push(`@${p.accountName} ${String(p.body).split('\n')[0].slice(0, 20)}`);
        log(`消した: @${p.accountName} ${p.postedThreadId}`);
      } else {
        await p.ref.set({ flopChecked: true, flopResult: 'kept', flopCounts: { likes, replies } }, { merge: true });
        result.kept.push(`@${p.accountName} いいね${likes} コメント${replies}`);
      }
    } catch (err) {
      result.errors.push(`@${p.accountName}: ${err.message}`);
      // 失敗したものは次回また試す（flopChecked は付けない）
    }
  }
  return result;
}
