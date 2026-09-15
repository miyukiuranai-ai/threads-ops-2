'use server';

import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/server/firebase.mjs';
import { getCurrentUser } from '@/lib/server/auth.mjs';
import { POST_TYPES } from '@/lib/server/generate.mjs';
import { REFERENCES_COLLECTION } from '@/lib/server/references.mjs';

/** 空行2つで投稿を区切る。1回に何本でも貼れるようにする。 */
function splitPosts(raw) {
  return String(raw ?? '')
    .split(/\n\s*\n\s*\n|\n---+\n/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20);
}

/**
 * 参考にしたい投稿を貼り付けて登録する。
 * 生成では「型（構造）だけを借り、語彙は借りない」教材として使う。
 */
export async function addReferences(formData) {
  const user = await getCurrentUser();
  const category = String(formData.get('category') ?? '').trim();
  if (!POST_TYPES[category]) return { error: '型を選んでください。' };

  const posts = splitPosts(formData.get('text'));
  if (!posts.length) {
    return { error: '投稿の本文を貼り付けてください。2本以上入れるときは空行を2つで区切ります。' };
  }
  if (posts.length > 30) return { error: '一度に登録できるのは30本までです。' };

  const db = getDb();
  const note = String(formData.get('note') ?? '').trim() || null;
  const now = new Date().toISOString();
  let added = 0;
  let skipped = 0;

  for (const text of posts) {
    // 同じ本文を二重登録しないよう、本文のハッシュをIDにする
    const id = createHash('sha1').update(text).digest('hex').slice(0, 16);
    const ref = db.collection(REFERENCES_COLLECTION).doc(id);
    if ((await ref.get()).exists) {
      skipped += 1;
      continue;
    }

    await ref.set({
      text,
      category,
      strength: note,
      usage: note, // 使いどころ（朝方限定、など）。生成のときにお手本に添えて渡す
      weakness: null,
      source: `画面から登録（${user.name}）`,
      charCount: [...text].length,
      lineCount: text.split(/\r?\n/).length,
      createdAt: now,
    });
    added += 1;
  }

  revalidatePath('/research');
  return {
    ok: `${added}本を登録しました。${skipped ? `（${skipped}本は登録済みのため飛ばしました）` : ''}`,
  };
}

/** 参考投稿を消す。 */
export async function removeReference(formData) {
  await getDb().collection(REFERENCES_COLLECTION).doc(String(formData.get('id'))).delete();
  revalidatePath('/research');
}
