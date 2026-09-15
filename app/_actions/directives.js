'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/server/firebase.mjs';
import { getCurrentUser, filterAccountsForUser } from '@/lib/server/auth.mjs';
import { listAccounts } from '@/lib/server/repo.mjs';
import { POST_TYPES } from '@/lib/server/generate.mjs';
import { tomorrowJst } from '@/lib/server/pipeline.mjs';
import { DIRECTIVES_COLLECTION, saveDirective, directiveId, ALL_ACCOUNTS } from '@/lib/server/directives.mjs';

/**
 * 「明日への指示」を保存する。15:30 の生成がこれを読んで作る（相談の費用はかからない）。
 * 構成（型の並び）と、文章の指示の両方を受ける。どちらか一方でもよい。
 */
export async function saveTomorrowNote(formData) {
  const user = await getCurrentUser();
  if (!user) return { error: 'ログインしてください。' };

  const accountId = String(formData.get('accountId') ?? '').trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(formData.get('date') ?? '')) ? String(formData.get('date')) : tomorrowJst();
  const instruction = String(formData.get('instruction') ?? '').trim();
  // 「バズ2、属人2」のような書き方を型の並びに直す。書いてあれば選択より優先
  const typesText = String(formData.get('typesText') ?? '').trim();
  const WORDS = [
    ['霊視開始', 'reading_open'],
    ['霊視', 'reading_open'],
    ['不安煽り', 'exclusion_hook'],
    ['不安', 'exclusion_hook'],
    ['除外', 'exclusion_hook'],
    ['超バズ特化', 'image_buzz'],
    ['超バズ', 'image_buzz'],
    ['画像バズ', 'image_buzz'],
    ['画像', 'image_buzz'],
    ['寺社', 'shrine_visit'],
    ['神社', 'shrine_visit'],
    ['素の属人', 'personal_note'],
    ['素', 'personal_note'],
    ['名乗り', 'attract_intro'],
    ['土地移動', 'travel_note'],
    ['土地', 'travel_note'],
    ['バズ', 'buzz_engagement'],
    ['属人', 'attract_intro'],
  ];
  let types = [];
  if (typesText) {
    const re = /(霊視開始|霊視|不安煽り|不安|除外|土地移動|土地|寺社|神社|素の属人|名乗り|超バズ特化|超バズ|画像バズ|画像|バズ特化|バズ|属人|素)\s*[×x本]?\s*(\d+)?/g;
    let m;
    while ((m = re.exec(typesText))) {
      const key = WORDS.find(([w]) => w === m[1])?.[1];
      const n = Math.max(1, Math.min(5, Number(m[2] ?? 1)));
      for (let i = 0; i < n; i += 1) types.push(key);
    }
    if (!types.length) return { error: '構成の書き方が読めませんでした。例: バズ2、属人1' };
    if (types.length > 6) return { error: '1日の本数は6本までにしてください。' };
  } else {
    types = String(formData.get('types') ?? '')
      .split(/[,\s、]+/)
      .map((s) => s.trim())
      .filter((s) => POST_TYPES[s]);
  }

  if (!accountId) return { error: '名義を選んでください。' };
  if (!instruction && !types.length) return { error: '構成か指示の文章のどちらかを入れてください。' };
  if ([...instruction].length > 1500) return { error: '指示は1500文字までにしてください。' };

  if (accountId !== ALL_ACCOUNTS) {
    const allowed = filterAccountsForUser(await listAccounts(), user);
    if (!allowed.some((a) => a.id === accountId)) return { error: 'その名義は扱えません。' };
  }

  await saveDirective({
    accountId,
    date,
    action: types.length ? 'mix' : 'note',
    types: types.length ? types : null,
    instruction: instruction || null,
    setBy: user.name,
  });

  revalidatePath('/research');
  return { ok: `${date} の指示を保存しました。15:30 の生成で読み込まれます。` };
}

/** 指示を消す。 */
export async function removeTomorrowNote(formData) {
  const accountId = String(formData.get('accountId') ?? '');
  const date = String(formData.get('date') ?? '');
  if (!accountId || !date) return;
  await getDb().collection(DIRECTIVES_COLLECTION).doc(directiveId(accountId, date)).delete();
  revalidatePath('/research');
}
