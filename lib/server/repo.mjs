// Firestore へのアクセスをまとめる層。画面とCronはここだけを使う。
// SPEC のスキーマ（accounts / personas / posts / replies / research / runs）に対応。
//
// 画面は何度も開かれるので、読み取りを抑える工夫を2段構えで入れている:
//   1. cache()          … 1回の描画のなかで同じ問い合わせを1度にまとめる
//   2. unstable_cache() … 数十秒のあいだ結果を使い回す。操作したときはタグで捨てる
import { cache } from 'react';
import { unstable_cache, revalidateTag } from 'next/cache';
import { getDb, COLLECTIONS } from './firebase.mjs';

const docToObj = (d) => ({ id: d.id, ...d.data() });

/** 結果を使い回す秒数。短くしすぎると読み取りが増える。 */
const CACHE_SECONDS = 45;

export const TAGS = {
  accounts: 'accounts',
  posts: 'posts',
  replies: 'replies',
  runs: 'runs',
  personas: 'personas',
};

/** 画面から何か操作したときに、使い回している結果を捨てる。 */
export function invalidate(...tags) {
  for (const tag of tags) revalidateTag(tag);
}

/** 名義一覧。表示順は名前順。 */
export const listAccounts = cache(
  unstable_cache(
    async () => {
      const snap = await getDb().collection(COLLECTIONS.accounts).get();
      return snap.docs.map(docToObj).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    },
    ['accounts'],
    { revalidate: CACHE_SECONDS, tags: [TAGS.accounts] }
  )
);

export async function getAccount(id) {
  const snap = await getDb().collection(COLLECTIONS.accounts).doc(id).get();
  return snap.exists ? docToObj(snap) : null;
}

/** 名義の投稿。並べ替えはJS側で行い、複合インデックスを不要にする。 */
export const listPosts = cache(
  unstable_cache(
    async (accountId, limit = 120) => {
      let query = getDb().collection(COLLECTIONS.posts);
      if (accountId) query = query.where('accountId', '==', accountId);
      const snap = await query.limit(limit).get();
      return snap.docs
        .map(docToObj)
        .sort((a, b) => String(a.scheduledAt ?? '').localeCompare(String(b.scheduledAt ?? '')));
    },
    ['posts'],
    { revalidate: CACHE_SECONDS, tags: [TAGS.posts] }
  )
);

/** ステータス別の件数。 */
export const countPostsByStatus = cache(async (accountId) => {
  const posts = await listPosts(accountId);
  return posts.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});
});

/**
 * 返信待ちのコメント件数。
 * 件数だけを数える問い合わせなので、対象が何件あっても読み取りは1回で済む。
 */
export const countPendingReplies = cache(
  unstable_cache(
    async (accountId) => {
      const base = getDb().collection(COLLECTIONS.replies).where('status', '==', 'queued');
      try {
        const query = accountId ? base.where('accountId', '==', accountId) : base;
        return (await query.count().get()).data().count;
      } catch {
        // 2条件の集計には複合インデックスが要る。無い環境では読み取って数える
        const snap = await base.limit(500).get();
        if (!accountId) return snap.size;
        return snap.docs.filter((d) => d.data().accountId === accountId).length;
      }
    },
    ['pending-replies'],
    { revalidate: CACHE_SECONDS, tags: [TAGS.replies] }
  )
);

/** その名義のコメント。件数が増えても重くならないよう上限をつける。 */
export const listRepliesForAccount = cache(
  unstable_cache(
    async (accountId, limit = 300) => {
      const snap = await getDb()
        .collection(COLLECTIONS.replies)
        .where('accountId', '==', accountId)
        .limit(limit)
        .get();
      return snap.docs
        .map(docToObj)
        .sort((a, b) => String(b.timestamp ?? '').localeCompare(String(a.timestamp ?? '')));
    },
    ['replies'],
    { revalidate: CACHE_SECONDS, tags: [TAGS.replies] }
  )
);

/** Cron の実行ログ（新しい順）。並べ替えは Firestore 側で行う。 */
export const listRuns = cache(
  unstable_cache(
    async (limit = 20) => {
      const snap = await getDb()
        .collection(COLLECTIONS.runs)
        .orderBy('startedAt', 'desc')
        .limit(limit)
        .get();
      return snap.docs.map(docToObj);
    },
    ['runs'],
    { revalidate: CACHE_SECONDS, tags: [TAGS.runs] }
  )
);

/** 直近のエラーだけ抜き出す。 */
export async function listRecentErrors({ limit = 5 } = {}) {
  const runs = await listRuns(25);
  return runs.filter((r) => r.status === 'failed').slice(0, limit);
}

export async function getPersona(personaId) {
  if (!personaId) return null;
  const snap = await getDb().collection(COLLECTIONS.personas).doc(personaId).get();
  return snap.exists ? docToObj(snap) : null;
}

export const listPersonas = cache(
  unstable_cache(
    async () => {
      const snap = await getDb().collection(COLLECTIONS.personas).get();
      return snap.docs.map(docToObj);
    },
    ['personas'],
    { revalidate: CACHE_SECONDS, tags: [TAGS.personas] }
  )
);

/** トークン失効までの残日数。期限が無ければ null。 */
export function daysUntil(iso) {
  if (!iso) return null;
  return Math.floor((new Date(iso).getTime() - Date.now()) / 86400000);
}
