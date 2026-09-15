'use server';

import { revalidatePath } from 'next/cache';
import { getDb, COLLECTIONS } from '@/lib/server/firebase.mjs';
import { getCurrentUser, filterAccountsForUser } from '@/lib/server/auth.mjs';
import { listAccounts, invalidate, TAGS } from '@/lib/server/repo.mjs';
import { planUpload, commitMedia, dropMedia, MEDIA_LIMITS } from '@/lib/server/storage.mjs';
import { STOCK_COLLECTION, looksPlaceSpecific } from '@/lib/server/stock.mjs';
import { randomUUID } from 'node:crypto';

/** 土地の画像を必ず人が付ける型。付けた画像は「場所が分かる画像」としてその名義のストックに残す。 */
const PLACE_IMAGE_TYPES = new Set(['travel_note', 'shrine_visit']);

/**
 * 人が投稿に付けた画像を、その名義のストックにも残す（本人 9/14「設定した画像はその名義のストックとして残して」）。
 * 系統は土地（imagePlace の都道府県）か、生成が求めていた系統、無ければ「手付け」。同じ画像が既にあれば何もしない。
 */
async function rememberAsStock({ entry, post, account, user }) {
  if (entry.kind !== 'image') return;
  const db = getDb();
  const dup = await db.collection(STOCK_COLLECTION).where('files', '!=', null).get().catch(() => null);
  if (dup && dup.docs.some((d) => (d.data().files ?? []).some((f) => f.fingerprint === entry.fingerprint))) return;
  const place = String(post.imagePlace ?? '').trim();
  const pref = place.split(/[\s、,，]+/)[0]?.replace(/[都道府県]$/, '') || '';
  const genre = pref || String(post.imageGenre ?? '').trim() || '手付け';
  const note = place || String(post.imageBrief ?? '').slice(0, 60) || null;
  await db.collection(STOCK_COLLECTION).doc(randomUUID()).set({
    kind: 'single',
    genre,
    note,
    accountId: account.id, // その名義だけ
    placeSpecific: PLACE_IMAGE_TYPES.has(post.type) || looksPlaceSpecific(genre, note ?? ''),
    files: [{ fingerprint: entry.fingerprint, path: entry.path, contentType: entry.contentType, bytes: entry.bytes }],
    addedBy: user?.name ?? 'admin',
    source: `投稿に付けた画像（${post.type ?? ''} ${post.slot ?? ''}）`,
    usedBy: { [account.id]: { count: 1, at: new Date().toISOString(), lastPostId: post.id ?? null } },
    usedTotal: 1,
    createdAt: new Date().toISOString(),
  });
}

/** その投稿を触ってよいか確かめ、投稿と名義を返す。 */
async function loadPost(postId) {
  const user = await getCurrentUser();
  const snap = await getDb().collection(COLLECTIONS.posts).doc(String(postId)).get();
  if (!snap.exists) throw new Error('その投稿は見つかりませんでした。');

  const post = { id: snap.id, ...snap.data() };
  const accounts = filterAccountsForUser(await listAccounts(), user);
  const account = accounts.find((a) => a.id === post.accountId);
  if (!account) throw new Error('この投稿を編集する権限がありません。');

  return { post, account };
}

/** 送り先の一時URLを作る。ファイル本体はブラウザから直接バケットへ送る。 */
export async function requestUpload(formData) {
  try {
    const postId = String(formData.get('postId') ?? '');
    const { post, account } = await loadPost(postId);

    const attached = Array.isArray(post.media) ? post.media : [];
    if (attached.length >= MEDIA_LIMITS.carousel.max) {
      return { error: `素材は${MEDIA_LIMITS.carousel.max}個までです。` };
    }

    const plan = await planUpload({
      fingerprint: String(formData.get('fingerprint') ?? ''),
      contentType: String(formData.get('contentType') ?? ''),
      bytes: Number(formData.get('bytes')),
      accountId: account.id,
      accountName: account.name,
    });

    return { ok: true, ...plan };
  } catch (err) {
    return { error: err.message };
  }
}

/** 送り終わったファイルを投稿に紐づける。 */
export async function attachMedia(formData) {
  try {
    const postId = String(formData.get('postId') ?? '');
    const { post, account } = await loadPost(postId);

    const entry = await commitMedia({
      fingerprint: String(formData.get('fingerprint') ?? ''),
      path: String(formData.get('path') ?? ''),
      kind: String(formData.get('kind') ?? ''),
      contentType: String(formData.get('contentType') ?? ''),
      bytes: Number(formData.get('bytes')),
      accountId: account.id,
      accountName: account.name,
      postId,
    });

    const media = [...(Array.isArray(post.media) ? post.media : []), entry];
    try {
      await rememberAsStock({ entry, post: { ...post, id: postId }, account, user: await getCurrentUser() });
    } catch {
      // ストックに残せなくても、投稿への添付は続ける
    }

    await getDb()
      .collection(COLLECTIONS.posts)
      .doc(postId)
      .set(
        {
          media,
          // 素材が揃ったので「画像が未準備」の保留を解く
          ...(post.status === 'held' && post.holdReason === '画像が未準備'
            ? { status: 'pending', holdReason: null }
            : {}),
          editedAt: new Date().toISOString(),
        },
        { merge: true }
      );

    invalidate(TAGS.posts);
    revalidatePath('/posts');
    return { ok: `${entry.kind === 'video' ? '動画' : '画像'}を追加しました。` };
  } catch (err) {
    return { error: err.message };
  }
}

/** 投稿から素材を外す。 */
export async function removeMedia(formData) {
  const postId = String(formData.get('postId') ?? '');
  const fingerprint = String(formData.get('fingerprint') ?? '');

  const { post } = await loadPost(postId);
  const target = (post.media ?? []).find((m) => m.fingerprint === fingerprint);
  const media = (post.media ?? []).filter((m) => m.fingerprint !== fingerprint);

  await getDb()
    .collection(COLLECTIONS.posts)
    .doc(postId)
    .set({ media, editedAt: new Date().toISOString() }, { merge: true });

  if (target) await dropMedia({ path: target.path, sha256: target.fingerprint });

  invalidate(TAGS.posts);
  revalidatePath('/posts');
}
