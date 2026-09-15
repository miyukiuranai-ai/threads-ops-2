'use server';

import { revalidatePath } from 'next/cache';
import { getDb, COLLECTIONS } from '@/lib/server/firebase.mjs';
import { getMe } from '@/lib/server/threads.mjs';
import { getCurrentUser } from '@/lib/server/auth.mjs';
import { DEFAULT_GROUP } from '@/lib/server/auth-core.mjs';
import { invalidate, TAGS } from '@/lib/server/repo.mjs';
import { HISTORY_COLLECTION } from '@/lib/server/scoring.mjs';
import { CURSORS_COLLECTION, REPLY_STATS_COLLECTION } from '@/lib/server/reply-state.mjs';

/** 生成ツールで発行した長期トークンは60日で失効する。 */
const LONG_LIVED_DAYS = 60;

/**
 * 画面から名義を追加する。
 * トークンを貼り付けるだけで、持ち主を確認して登録する（コマンド操作が不要になる）。
 */
export async function addAccount(formData) {
  const token = String(formData.get('accessToken') ?? '').trim();
  if (!token) return { error: 'トークンを入力してください。' };

  const user = await getCurrentUser();
  const db = getDb();

  let me;
  try {
    me = await getMe({ accessToken: token, fields: 'id,username' });
  } catch (err) {
    return { error: `トークンを確認できませんでした: ${err.message.split('\n').pop().trim()}` };
  }

  const ref = db.collection(COLLECTIONS.accounts).doc(me.id);
  const snap = await ref.get();
  const prev = snap.exists ? snap.data() : {};

  // 他の人のグループの名義は上書きさせない
  if (snap.exists && user.role !== 'admin' && (prev.group ?? DEFAULT_GROUP) !== user.group) {
    return { error: `@${me.username} は別のグループで登録されています。` };
  }

  const now = new Date().toISOString();
  await ref.set(
    {
      name: me.username,
      threadsUserId: me.id,
      accessToken: token,
      tokenExpiresAt: new Date(Date.now() + LONG_LIVED_DAYS * 86400000).toISOString(),
      group: prev.group ?? (user.role === 'admin' ? DEFAULT_GROUP : user.group),
      personaId: prev.personaId ?? null,
      status: prev.status ?? 'paused',
      autoReply: prev.autoReply ?? false,
      linkStyle: prev.linkStyle ?? 'both',
      createdAt: prev.createdAt ?? now,
      updatedAt: now,
    },
    { merge: true }
  );

  invalidate(TAGS.accounts);
  revalidatePath('/settings');
  revalidatePath('/');
  return { ok: `@${me.username} を${snap.exists ? '更新' : '追加'}しました。` };
}

/** 名義の稼働状態を切り替える（停止中は投稿も返信もしない）。 */
export async function setAccountStatus(formData) {
  const id = String(formData.get('accountId'));
  const status = String(formData.get('status'));
  if (!['active', 'paused'].includes(status)) return;

  await getDb()
    .collection(COLLECTIONS.accounts)
    .doc(id)
    .set({ status, updatedAt: new Date().toISOString() }, { merge: true });
  invalidate(TAGS.accounts);
  revalidatePath('/settings');
}

/** 自動返信の ON / OFF。 */
export async function setAutoReply(formData) {
  const id = String(formData.get('accountId'));
  const autoReply = String(formData.get('autoReply')) === 'on';

  await getDb()
    .collection(COLLECTIONS.accounts)
    .doc(id)
    .set({ autoReply, updatedAt: new Date().toISOString() }, { merge: true });
  invalidate(TAGS.accounts);
  revalidatePath('/settings');
}

/**
 * 締切（23:30）の自動仕分けをこの名義に効かせるかどうか。
 * OFF にすると、承認しない限り投稿されない（人が全件見る運用向け）。
 */
export async function setAutoReviewExempt(formData) {
  const id = String(formData.get('accountId'));
  const exempt = String(formData.get('exempt')) === 'on';

  await getDb()
    .collection(COLLECTIONS.accounts)
    .doc(id)
    .set({ autoReviewExempt: exempt, updatedAt: new Date().toISOString() }, { merge: true });
  invalidate(TAGS.accounts);
  revalidatePath('/settings');
}

/** 名義のグループを変える（管理者だけ）。 */
export async function setAccountGroup(formData) {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return;

  const id = String(formData.get('accountId'));
  const group = String(formData.get('group') ?? '').trim() || DEFAULT_GROUP;

  await getDb()
    .collection(COLLECTIONS.accounts)
    .doc(id)
    .set({ group, updatedAt: new Date().toISOString() }, { merge: true });
  invalidate(TAGS.accounts);
  revalidatePath('/settings');
}

/** Firestore の一括削除は1回500件まで。少なめに区切って回す。 */
const DELETE_CHUNK = 300;

/** 問い合わせに当てはまるドキュメントをすべて消す。 */
async function deleteQuery(db, query) {
  let removed = 0;
  for (;;) {
    const snap = await query.limit(DELETE_CHUNK).get();
    if (snap.empty) return removed;

    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    removed += snap.size;

    if (snap.size < DELETE_CHUNK) return removed;
  }
}

/**
 * 名義をツールから外す。
 *
 * 消えるのはこのツールが持っているデータだけで、
 * Threads 側のアカウントも、すでに投稿された内容もそのまま残る。
 * 取り違いを防ぐため、ユーザー名を入力してもらってから実行する。
 */
export async function removeAccount(formData) {
  const user = await getCurrentUser();
  const db = getDb();

  const id = String(formData.get('accountId') ?? '');
  const typed = String(formData.get('confirm') ?? '')
    .trim()
    .replace(/^@/, '');

  const snap = await db.collection(COLLECTIONS.accounts).doc(id).get();
  if (!snap.exists) return { error: 'その名義は見つかりませんでした。' };
  const account = { id: snap.id, ...snap.data() };

  if (user.role !== 'admin' && (account.group ?? DEFAULT_GROUP) !== user.group) {
    return { error: 'この名義を削除する権限がありません。' };
  }
  if (typed !== account.name) {
    return { error: '入力した名前が一致しません。' };
  }

  // 返信の記録から、この名義が使っていた投稿を拾っておく（カーソルを消すため）
  const replySnap = await db
    .collection(COLLECTIONS.replies)
    .where('accountId', '==', id)
    .select('threadId')
    .get();
  const threadIds = [...new Set(replySnap.docs.map((d) => d.data().threadId).filter(Boolean))];

  const removed = {
    posts: await deleteQuery(db, db.collection(COLLECTIONS.posts).where('accountId', '==', id)),
    replies: await deleteQuery(db, db.collection(COLLECTIONS.replies).where('accountId', '==', id)),
    history: await deleteQuery(db, db.collection(HISTORY_COLLECTION).where('accountId', '==', id)),
  };

  for (let i = 0; i < threadIds.length; i += DELETE_CHUNK) {
    const batch = db.batch();
    for (const threadId of threadIds.slice(i, i + DELETE_CHUNK)) {
      batch.delete(db.collection(CURSORS_COLLECTION).doc(threadId));
    }
    await batch.commit();
  }

  await db.collection(REPLY_STATS_COLLECTION).doc(id).delete();
  await db.collection(COLLECTIONS.accounts).doc(id).delete();

  // 他の名義が使っていないキャラ設定は、取り残さないよう一緒に消す
  let persona = null;
  if (account.personaId) {
    const others = await db
      .collection(COLLECTIONS.accounts)
      .where('personaId', '==', account.personaId)
      .limit(1)
      .get();
    if (others.empty) {
      await db.collection(COLLECTIONS.personas).doc(account.personaId).delete();
      persona = account.personaId;
    }
  }

  invalidate(TAGS.accounts, TAGS.posts, TAGS.replies, TAGS.personas);
  revalidatePath('/settings');
  revalidatePath('/personas');
  revalidatePath('/');

  return {
    ok:
      `@${account.name} を外しました（投稿案 ${removed.posts}件 / コメント ${removed.replies}件 / 履歴 ${removed.history}件` +
      `${persona ? ` / キャラ設定 ${persona}` : ''}を削除）。Threads 側のアカウントと投稿はそのままです。`,
  };
}
