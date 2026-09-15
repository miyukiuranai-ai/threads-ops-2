// 画像・動画の置き場所（Firebase Storage）。
//
// Threads API はファイルそのものを受け取らず、URL を渡して取りに来させる方式なので、
// 一度どこかに置いて公開URLを作る必要がある。
// バケットは非公開のままにして、投稿のたびに期限つきのURLを発行する。
import { createHash } from 'node:crypto';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { getDb } from './firebase.mjs';

/** Threads の受け付ける形式と上限（公式ドキュメントの値）。 */
export const MEDIA_LIMITS = {
  image: {
    types: ['image/jpeg', 'image/png'],
    maxBytes: 8 * 1024 * 1024, // 8MB
    note: 'JPEG か PNG。8MBまで。幅320〜1440px、縦横比は10:1まで',
  },
  video: {
    types: ['video/mp4', 'video/quicktime'],
    maxBytes: 1024 * 1024 * 1024, // 1GB
    note: 'MP4 か MOV（H.264/HEVC + AAC）。1GBまで、5分まで。23〜60fps、横1920pxまで',
  },
  /** カルーセルにできる枚数。 */
  carousel: { min: 2, max: 20 },
};

/** 一時URLの有効期間。投稿処理が終わるまで持てばよい。 */
const SIGNED_URL_MINUTES = 60;

/** アップロードされたファイルの記録（使い回しの判定に使う）。 */
export const MEDIA_COLLECTION = 'media';

const BUCKET_KEY = Symbol.for('threads-ops.storage-bucket');

/** バケットを返す。名前は環境変数がなければプロジェクトIDから組み立てる。 */
export function getBucket() {
  if (globalThis[BUCKET_KEY]) return globalThis[BUCKET_KEY];

  // getDb() 側で初期化済みのアプリを使い回す
  getDb();
  const app = getApps()[0] ?? initializeApp({ credential: cert({}) });

  const name =
    process.env.FIREBASE_STORAGE_BUCKET ?? `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`;

  const bucket = getStorage(app).bucket(name);
  globalThis[BUCKET_KEY] = bucket;
  return bucket;
}

/** 種類を判定する。対応していなければ null。 */
export function kindOf(contentType) {
  if (MEDIA_LIMITS.image.types.includes(contentType)) return 'image';
  if (MEDIA_LIMITS.video.types.includes(contentType)) return 'video';
  return null;
}

/**
 * ファイルを置いて、記録を残す。
 * 中身から指紋（SHA-256）を取り、他の名義で使ったファイルは弾く。
 */
export async function putMedia({ buffer, contentType, accountId, accountName, postId }) {
  const kind = kindOf(contentType);
  if (!kind) {
    throw new Error(`この形式には対応していません（${contentType || '不明'}）。JPEG / PNG / MP4 / MOV を使ってください。`);
  }

  const limit = MEDIA_LIMITS[kind];
  if (buffer.length > limit.maxBytes) {
    const mb = (buffer.length / 1024 / 1024).toFixed(1);
    throw new Error(`ファイルが大きすぎます（${mb}MB）。${limit.note}`);
  }

  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const db = getDb();
  const ref = db.collection(MEDIA_COLLECTION).doc(sha256);
  const snap = await ref.get();

  // 同じファイルを別の名義で使うと、同じ運営者だと分かってしまう
  if (snap.exists) {
    const prev = snap.data();
    if (prev.accountId && prev.accountId !== accountId) {
      throw new Error(
        `このファイルは @${prev.accountName ?? prev.accountId} で既に使われています。名義ごとに別の素材を用意してください。`
      );
    }
  }

  const ext = contentType.split('/')[1].replace('quicktime', 'mov').replace('jpeg', 'jpg');
  const path = `posts/${accountId}/${sha256.slice(0, 16)}.${ext}`;

  await getBucket().file(path).save(buffer, {
    contentType,
    resumable: false,
    metadata: { cacheControl: 'public, max-age=31536000' },
  });

  const now = new Date().toISOString();
  await ref.set(
    {
      sha256,
      path,
      kind,
      contentType,
      bytes: buffer.length,
      accountId,
      accountName: accountName ?? null,
      postIds: [...new Set([...(snap.exists ? (snap.data().postIds ?? []) : []), postId])],
      createdAt: snap.exists ? (snap.data().createdAt ?? now) : now,
      updatedAt: now,
    },
    { merge: true }
  );

  return { path, kind, contentType, sha256, bytes: buffer.length };
}

/** Threads に渡すための、期限つきURLを作る。 */
export async function signedUrl(path, minutes = SIGNED_URL_MINUTES) {
  const [url] = await getBucket()
    .file(path)
    .getSignedUrl({ action: 'read', expires: Date.now() + minutes * 60000 });
  return url;
}

/** 置いたファイルを消す（投稿から外したとき）。 */
export async function dropMedia({ path, sha256 }) {
  try {
    await getBucket().file(path).delete({ ignoreNotFound: true });
  } catch {
    // 消せなくても投稿の編集は続けられる
  }
  if (sha256) await getDb().collection(MEDIA_COLLECTION).doc(sha256).delete().catch(() => {});
}

/** 投稿に付いているメディア。古い形式（imageUrls）も拾う。 */
export function attachedMedia(post) {
  if (Array.isArray(post?.media) && post.media.length) return post.media;
  return (post?.imageUrls ?? []).map((url) => ({ url, kind: 'image' }));
}

// ---------- ブラウザから直接送るための手順 ----------
//
// Vercel は4.5MBを超えるリクエストを通せないため、画像・動画は
// サーバーを経由せずバケットへ直接送る。
//   1. planUpload()  … 形式と大きさを確かめ、送り先の一時URLを返す
//   2. ブラウザが PUT でファイルを送る
//   3. commitMedia() … 投稿に紐づけ、記録を残す

/** アップロード用の一時URLの有効期間。 */
const UPLOAD_URL_MINUTES = 30;

/**
 * 送ってよいか確かめ、送り先を作る。
 * fingerprint は「先頭4MBのSHA-256 + サイズ」で、使い回しの判定に使う。
 */
export async function planUpload({ fingerprint, contentType, bytes, accountId, accountName }) {
  const kind = kindOf(contentType);
  if (!kind) {
    throw new Error(`この形式には対応していません（${contentType || '不明'}）。JPEG / PNG / MP4 / MOV を使ってください。`);
  }

  const limit = MEDIA_LIMITS[kind];
  if (!Number.isFinite(bytes) || bytes <= 0) throw new Error('ファイルを読み取れませんでした。');
  if (bytes > limit.maxBytes) {
    throw new Error(`ファイルが大きすぎます（${(bytes / 1024 / 1024).toFixed(1)}MB）。${limit.note}`);
  }
  if (!/^[0-9a-f]{64}-\d+$/.test(String(fingerprint ?? ''))) {
    throw new Error('ファイルの指紋を作れませんでした。');
  }

  // 同じ画像を別の名義や別の日に使い回すのは構わない（本人の方針。以前は名義をまたぐ使い回しを止めていた）

  const ext = contentType.split('/')[1].replace('quicktime', 'mov').replace('jpeg', 'jpg');
  const path = `posts/${accountId}/${fingerprint.slice(0, 16)}.${ext}`;

  const [uploadUrl] = await getBucket()
    .file(path)
    .getSignedUrl({
      version: 'v4',
      action: 'write',
      contentType,
      expires: Date.now() + UPLOAD_URL_MINUTES * 60000,
    });

  return { uploadUrl, path, kind, accountName };
}

/** 送り終わったファイルを記録する。 */
export async function commitMedia({
  fingerprint,
  path,
  kind,
  contentType,
  bytes,
  accountId,
  accountName,
  postId,
}) {
  const [exists] = await getBucket().file(path).exists();
  if (!exists) throw new Error('アップロードが完了していません。もう一度お試しください。');

  const now = new Date().toISOString();
  await getDb()
    .collection(MEDIA_COLLECTION)
    .doc(fingerprint)
    .set(
      {
        fingerprint,
        path,
        kind,
        contentType,
        bytes,
        accountId,
        accountName: accountName ?? null,
        postId,
        createdAt: now,
      },
      { merge: true }
    );

  return { path, kind, contentType, bytes, fingerprint };
}
