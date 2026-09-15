// firebase-admin の初期化。Firestore と Storage。
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { env } from './env.mjs';

let app;
function getApp() {
  if (app) return app;
  if (getApps().length) { app = getApps()[0]; return app; }
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    throw new Error('FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY が未設定です');
  }
  app = initializeApp({
    credential: cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY,
    }),
    storageBucket: env.FIREBASE_STORAGE_BUCKET || undefined,
  });
  return app;
}

let _db;
export function db() {
  if (!_db) {
    _db = getFirestore(getApp());
    try { _db.settings({ ignoreUndefinedProperties: true }); } catch { /* 二度目は無視 */ }
  }
  return _db;
}

export function bucket() {
  if (!env.FIREBASE_STORAGE_BUCKET) throw new Error('FIREBASE_STORAGE_BUCKET が未設定です');
  return getStorage(getApp()).bucket(env.FIREBASE_STORAGE_BUCKET);
}

export { FieldValue };

export function docToObj(snap) {
  if (!snap || !snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

export async function getDoc(col, id) {
  const snap = await db().collection(col).doc(id).get();
  return docToObj(snap);
}

export async function setDoc(col, id, data, { merge = true } = {}) {
  await db().collection(col).doc(id).set(data, { merge });
  return id;
}

export async function addDoc(col, data) {
  const ref = await db().collection(col).add(data);
  return ref.id;
}

export async function updateDoc(col, id, data) {
  await db().collection(col).doc(id).update(data);
}

export async function deleteDoc(col, id) {
  await db().collection(col).doc(id).delete();
}

/** where を配列で渡して一覧。[['status','==','active'], ...] */
export async function listDocs(col, { where = [], orderBy = null, limit = null } = {}) {
  let q = db().collection(col);
  for (const [f, op, v] of where) q = q.where(f, op, v);
  if (orderBy) q = Array.isArray(orderBy) ? q.orderBy(orderBy[0], orderBy[1]) : q.orderBy(orderBy);
  if (limit) q = q.limit(limit);
  const snap = await q.get();
  return snap.docs.map(docToObj);
}

/** まとめて削除（500 件ずつ） */
export async function deleteWhere(col, where) {
  let total = 0;
  for (;;) {
    let q = db().collection(col);
    for (const [f, op, v] of where) q = q.where(f, op, v);
    const snap = await q.limit(400).get();
    if (snap.empty) break;
    const batch = db().batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    total += snap.size;
    if (snap.size < 400) break;
  }
  return total;
}

export function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
