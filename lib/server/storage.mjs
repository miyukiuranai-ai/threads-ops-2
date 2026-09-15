// Firebase Storage（GCS）。非公開バケット、署名付き URL、指紋で重複を避ける。
import { createHash } from 'node:crypto';
import { bucket, getDoc, setDoc, listDocs } from './firebase.mjs';
import { nowIso } from './time.mjs';

export const MAX_FINGERPRINT_BYTES = 4 * 1024 * 1024;

/** 指紋: sha256（先頭 4MB）- サイズ */
export function fingerprintOf(buf) {
  const head = buf.subarray(0, MAX_FINGERPRINT_BYTES);
  return `${createHash('sha256').update(head).digest('hex')}-${buf.length}`;
}

export function kindOf(contentType) {
  if (String(contentType).startsWith('video/')) return 'video';
  if (String(contentType).startsWith('image/')) return 'image';
  return 'file';
}

export function extOf(contentType) {
  const map = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/quicktime': 'mov' };
  return map[contentType] || 'bin';
}

/** 直接 PUT 用の署名付き URL（15 分）。path は media/{accountId}/{fingerprint}.{ext} */
export async function signedUploadUrl({ path, contentType, minutes = 15 }) {
  const [url] = await bucket().file(path).getSignedUrl({ version: 'v4', action: 'write', expires: Date.now() + minutes * 60000, contentType });
  return url;
}

/** 読み出しの署名付き URL（既定 60 分）。Threads がダウンロードする */
export async function signedReadUrl(path, { minutes = 60 } = {}) {
  const [url] = await bucket().file(path).getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + minutes * 60000 });
  return url;
}

export async function exists(path) {
  const [ok] = await bucket().file(path).exists();
  return ok;
}

export async function uploadBuffer({ path, buf, contentType }) {
  await bucket().file(path).save(buf, { contentType, resumable: false, metadata: { cacheControl: 'private, max-age=0' } });
  return path;
}

export async function downloadBuffer(path) {
  const [buf] = await bucket().file(path).download();
  return buf;
}

export async function deleteFile(path) {
  try { await bucket().file(path).delete(); } catch { /* 無ければ無視 */ }
}

/** media コレクション（指紋の台帳） */
export async function findMedia(fingerprint) { return getDoc('media', fingerprint); }

export async function recordMedia({ fingerprint, path, kind, contentType, bytes, accountId, accountName, postId }) {
  const existing = await getDoc('media', fingerprint);
  const doc = {
    path, kind, contentType, bytes,
    accountId: accountId ?? existing?.accountId ?? null,
    accountName: accountName ?? existing?.accountName ?? null,
    postId: postId ?? existing?.postId ?? null,
    createdAt: existing?.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
  await setDoc('media', fingerprint, doc);
  return { id: fingerprint, ...doc };
}

export async function listMedia({ accountId } = {}) {
  return listDocs('media', { where: accountId ? [['accountId', '==', accountId]] : [] });
}

export function mediaPath({ accountId, fingerprint, contentType }) {
  return `media/${accountId || 'shared'}/${fingerprint}.${extOf(contentType)}`;
}

/** バケットの CORS（storage:setup） */
export async function setupCors(origins = ['*']) {
  await bucket().setCorsConfiguration([{ origin: origins, method: ['GET', 'PUT', 'HEAD'], responseHeader: ['Content-Type', 'x-goog-resumable'], maxAgeSeconds: 3600 }]);
}
