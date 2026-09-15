'use server';
import { revalidatePath } from 'next/cache';
import { requireSession, assertAccountVisible } from '../_lib/session';
import { getPost, approvePost, rejectPost, holdPost, editPost, updatePost } from '@/lib/server/posts.mjs';
import { deletePostedThread } from '@/lib/server/publish.mjs';
import { recordMedia, findMedia } from '@/lib/server/storage.mjs';
import { rememberAttached } from '@/lib/server/stock.mjs';
import { PLACE_IMAGE_TYPES } from '@/lib/server/post-types.mjs';

async function load(formData) {
  const session = await requireSession();
  const id = String(formData.get('id') || '');
  const post = await getPost(id);
  if (!post) throw new Error('投稿がありません');
  await assertAccountVisible(session, post.accountId);
  return { session, post };
}

export async function approveAction(formData) {
  const { session, post } = await load(formData);
  if (post.imageRequired && !(post.media || []).length) {
    await holdPost(post.id, session.user, '画像が未準備');
  } else {
    await approvePost(post.id, session.user);
  }
  revalidatePath('/posts');
}

export async function rejectAction(formData) {
  const { session, post } = await load(formData);
  await rejectPost(post.id, session.user, String(formData.get('reason') || '手動で却下'));
  revalidatePath('/posts');
}

export async function holdAction(formData) {
  const { session, post } = await load(formData);
  await holdPost(post.id, session.user, String(formData.get('reason') || '保留'));
  revalidatePath('/posts');
}

export async function editAction(formData) {
  const { session, post } = await load(formData);
  await editPost(post.id, {
    body: String(formData.get('body') ?? post.body),
    keyword: formData.get('keyword') != null ? String(formData.get('keyword')) : undefined,
    slot: formData.get('slot') ? String(formData.get('slot')) : undefined,
    plannedDate: formData.get('plannedDate') ? String(formData.get('plannedDate')) : undefined,
    imageBrief: formData.get('imageBrief') != null ? String(formData.get('imageBrief')) : undefined,
    intent: formData.get('intent') != null ? String(formData.get('intent')) : undefined,
  }, session.user);
  revalidatePath('/posts');
}

export async function deleteThreadAction(formData) {
  const { session, post } = await load(formData);
  await deletePostedThread(post.id, session.user);
  revalidatePath('/posts');
}

/** 直接 GCS に PUT したあと、投稿に付ける（指紋で重複を避ける） */
export async function attachMediaAction({ id, files }) {
  const session = await requireSession();
  const post = await getPost(id);
  if (!post) throw new Error('投稿がありません');
  await assertAccountVisible(session, post.accountId);
  const media = [...(post.media || [])];
  for (const f of files || []) {
    if (!f?.fingerprint || !f?.path) continue;
    await recordMedia({ fingerprint: f.fingerprint, path: f.path, kind: f.kind, contentType: f.contentType, bytes: f.bytes, accountId: post.accountId, accountName: post.accountName, postId: post.id });
    if (!media.some((m) => m.fingerprint === f.fingerprint)) media.push({ fingerprint: f.fingerprint, path: f.path, kind: f.kind, contentType: f.contentType, bytes: f.bytes });
  }
  const patch = { media };
  if (post.status === 'held' && /画像が未準備/.test(post.holdReason || '')) { patch.status = 'pending'; patch.holdReason = null; patch.requeuedAt = new Date().toISOString(); }
  await updatePost(post.id, patch);
  // 人が付けた画像を、その名義のストックに残す
  try {
    const place = PLACE_IMAGE_TYPES.includes(post.type);
    await rememberAttached({ accountId: post.accountId, files: media.slice(-files.length), genre: place ? (post.imagePlace || '').split(/\s+/)[0] || '土地' : post.imageGenre || '手付け', note: place ? post.imagePlace || '' : post.imageNote || '', placeSpecific: place ? true : undefined, addedBy: session.user });
  } catch { /* ストック登録の失敗は投稿に影響させない */ }
  revalidatePath('/posts');
  return { ok: true, media };
}

export async function removeMediaAction(formData) {
  const { post } = await load(formData);
  const fp = String(formData.get('fingerprint') || '');
  await updatePost(post.id, { media: (post.media || []).filter((m) => m.fingerprint !== fp) });
  revalidatePath('/posts');
}

export async function mediaExists(fingerprint) {
  await requireSession();
  return findMedia(fingerprint);
}
