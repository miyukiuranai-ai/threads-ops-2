'use server';

import { revalidatePath } from 'next/cache';
import { getDb, COLLECTIONS } from '@/lib/server/firebase.mjs';
import { getCurrentUser, filterAccountsForUser } from '@/lib/server/auth.mjs';
import { listAccounts, invalidate, TAGS } from '@/lib/server/repo.mjs';
import { POST_TYPES } from '@/lib/server/generate.mjs';
import { parseBands } from '@/lib/server/schedule.mjs';
import { MODELS, MODEL } from '@/lib/server/claude.mjs';

const IMAGE_POLICIES = ['never', 'rarely', 'sometimes', 'often'];

/** その利用者が触ってよい Persona と名義。 */
async function scopeFor(user) {
  const accounts = filterAccountsForUser(await listAccounts(), user);
  return {
    accounts,
    personaIds: new Set(accounts.map((a) => a.personaId).filter(Boolean)),
  };
}

/** Persona の ID は名義名から作る（英数字と - _ だけにする）。 */
function toPersonaId(accountName) {
  return String(accountName ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** 改行区切りの入力を配列にする。 */
function toLines(value) {
  return String(value ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** カンマ区切りの入力を配列にする。 */
function toList(value) {
  return String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "HH:MM-HH:MM" を確かめる。空なら null を返す。 */
function checkWindow(value, label, { required = false } = {}) {
  const text = String(value ?? '').trim();
  if (!text) {
    if (required) throw new Error(`${label}を入力してください。`);
    return null;
  }
  const [from, to] = text.split('-').map((s) => s.trim());
  if (!TIME.test(from ?? '') || !TIME.test(to ?? '')) {
    throw new Error(`${label}は「06:00-23:55」の形で入力してください。`);
  }
  return `${from}-${to}`;
}

/** "3" か "3-5" を確かめる。 */
function checkRange(value, label, { min = 1, max = 24 } = {}) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label}を入力してください。`);

  const parts = text.split('-').map((s) => s.trim());
  const nums = parts.map(Number);
  if (parts.length > 2 || nums.some((n) => !Number.isFinite(n))) {
    throw new Error(`${label}は「3」か「3-5」の形で入力してください。`);
  }
  if (nums.some((n) => n < min || n > max)) {
    throw new Error(`${label}は ${min}〜${max} の範囲で入力してください。`);
  }
  if (nums.length === 2 && nums[0] > nums[1]) {
    throw new Error(`${label}の範囲が逆になっています。`);
  }
  return parts.join('-');
}

/**
 * キャラ設定の作成・更新。
 * 新規のときは accountId を受け取り、その名義に紐づける。
 */
/** 手本にする期間の日付。空欄は null。書式が違えば例外。 */
function dateOrNull(v) {
  const t = String(v ?? '').trim();
  if (!t) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) throw new Error('手本にする期間は YYYY-MM-DD の形で入れてください。');
  return t;
}

export async function savePersona(formData) {
  const user = await getCurrentUser();
  const db = getDb();
  const { accounts, personaIds } = await scopeFor(user);

  const givenId = String(formData.get('personaId') ?? '').trim();
  const accountId = String(formData.get('accountId') ?? '').trim();

  let personaId = givenId;
  let account = null;

  if (personaId) {
    if (user.role !== 'admin' && !personaIds.has(personaId)) {
      return { error: 'このキャラ設定を編集する権限がありません。' };
    }
  } else {
    account = accounts.find((a) => a.id === accountId);
    if (!account) return { error: '名義を選んでください。' };

    personaId = toPersonaId(account.name);
    if (!personaId) return { error: '名義名からIDを作れませんでした。管理者に連絡してください。' };

    const existing = await db.collection(COLLECTIONS.personas).doc(personaId).get();
    if (existing.exists && user.role !== 'admin' && !personaIds.has(personaId)) {
      return { error: `ID「${personaId}」は他のグループで使われています。` };
    }
  }

  let data;
  try {
    const nightType = String(formData.get('nightType') ?? '').trim() || null;
    const dayTypes = toList(formData.get('dayTypes'));

    for (const t of [...dayTypes, nightType].filter(Boolean)) {
      if (!POST_TYPES[t]) throw new Error(`知らない型が入っています: ${t}`);
    }
    if (!dayTypes.length) throw new Error('日中の型を1つ以上選んでください。');

    const imagePolicy = String(formData.get('imagePolicy') ?? 'sometimes').trim();
    if (!IMAGE_POLICIES.includes(imagePolicy)) throw new Error('画像の頻度が不正です。');

    const name = String(formData.get('name') ?? '').trim();
    if (!name) throw new Error('名前を入力してください。');

    const characterDoc = String(formData.get('characterDoc') ?? '').trim();
    if (characterDoc.length < 40) {
      throw new Error('人物設定が短すぎます。土地・名乗り・世界観を書いてください。');
    }

    // 時間帯（1行に1つ）。書かれていれば、こちらが投稿時刻の決め方になる
    const bands = toLines(formData.get('bands'));
    const parsed = parseBands(bands); // 書式が違えばここで例外
    for (const b of parsed) {
      if (b.type && !POST_TYPES[b.type]) throw new Error(`知らない型が入っています: ${b.type}`);
    }

    const model = String(formData.get('model') ?? '').trim() || MODEL;
    if (!MODELS[model]) throw new Error('モデルの選択が不正です。');

    data = {
      bands,
      model,
      reuseWinners: String(formData.get('reuseWinners') ?? '') === 'on',
      useDayPatterns: String(formData.get('useDayPatterns') ?? '') === 'on',
      buzzTrial: String(formData.get('buzzTrial') ?? '') === 'on',
      slumpBuzz: String(formData.get('slumpBuzz') ?? '') === 'on',
      autoDeleteFlops: String(formData.get('autoDeleteFlops') ?? '') === 'on',
      noSuperBuzz: String(formData.get('noSuperBuzz') ?? '') === 'on',
      slumpPosts: Math.max(1, Math.min(3, Number(formData.get('slumpPosts')) || 1)),
      buzzTone: String(formData.get('buzzTone') ?? '') === 'light' ? 'light' : 'normal',
      dayMix: String(formData.get('dayMix') ?? '')
        .split(/[,\s、]+/)
        .map((s) => s.trim())
        .filter((s) => POST_TYPES[s]),
      slumpType: ['buzz_engagement', 'reading_open'].includes(String(formData.get('slumpType') ?? ''))
        ? String(formData.get('slumpType'))
        : 'buzz_engagement',
      askPerDay: String(formData.get('askPerDay') ?? '').trim()
        ? checkRange(formData.get('askPerDay'), '合言葉を求める本数', { min: 0, max: 12 })
        : null,
      winnersFrom: dateOrNull(formData.get('winnersFrom')),
      winnersTo: dateOrNull(formData.get('winnersTo')),
      name,
      characterDoc,
      postsPerDay: checkRange(formData.get('postsPerDay'), '1日の本数', { min: 1, max: 12 }),
      activeWindow: checkWindow(formData.get('activeWindow'), '投稿する時間帯', { required: true }),
      minGap: checkRange(formData.get('minGap'), '最短の間隔（分）', { min: 30, max: 720 }),
      nightAnchor: checkWindow(formData.get('nightAnchor'), '深夜の固定枠'),
      nightType,
      dayTypes,
      imagePolicy,
      styleRules: toLines(formData.get('styleRules')),
      ngWords: toLines(formData.get('ngWords')),
      lineUrl: String(formData.get('lineUrl') ?? '').trim() || null,
      postingSlots: toList(formData.get('postingSlots')),
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    return { error: err.message };
  }

  await db.collection(COLLECTIONS.personas).doc(personaId).set(data, { merge: true });

  // 新しく作ったときは、その場で名義に紐づける
  if (account) {
    await db
      .collection(COLLECTIONS.accounts)
      .doc(account.id)
      .set({ personaId, updatedAt: new Date().toISOString() }, { merge: true });
  }

  invalidate(TAGS.personas, TAGS.accounts);
  revalidatePath('/personas');
  revalidatePath(`/personas/${personaId}`);
  revalidatePath('/settings');

  return { ok: `${data.name} を保存しました。`, personaId };
}

/** 名義に使うキャラ設定を選び直す。 */
export async function assignPersona(formData) {
  const user = await getCurrentUser();
  const { accounts, personaIds } = await scopeFor(user);

  const accountId = String(formData.get('accountId') ?? '');
  const personaId = String(formData.get('personaId') ?? '').trim() || null;

  if (!accounts.some((a) => a.id === accountId)) return;
  if (personaId && user.role !== 'admin' && !personaIds.has(personaId)) return;

  await getDb()
    .collection(COLLECTIONS.accounts)
    .doc(accountId)
    .set({ personaId, updatedAt: new Date().toISOString() }, { merge: true });

  invalidate(TAGS.accounts);
  revalidatePath('/settings');
  revalidatePath('/personas');
}
