// Anthropic の利用額を見積もり、残高が尽きそうなら知らせる。
//
// 残高そのものを取れるAPIは公開されていないので、
//   「いま残っている額」を人が入力 → そこからの消費を積み上げる
// という形にしている。消費は実行ログに残っているトークン数から計算する。
import { getDb, COLLECTIONS } from './firebase.mjs';
import { MODEL } from './claude.mjs';

/** 設定の置き場所。 */
export const SETTINGS_DOC = { collection: 'settings', id: 'anthropic' };

/** 100万トークンあたりの単価（USD）。 */
const PRICING = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

/** 残り日数がこれを切ったら知らせる。 */
export const WARN_DAYS = 7;
export const DANGER_DAYS = 3;

/**
 * 課金で止まったことを示す文言。
 * 「quota」だけで拾うと Firestore の resource_exhausted まで引っかかるので、
 * Anthropic が返す言い回しだけに絞る。
 */
const BILLING_WORDS = [
  'credit balance is too low',
  'billing_error',
  'insufficient_quota',
  'insufficient credit',
  'your credit balance',
];

/** 古い失敗を引きずらないよう、この時間内の実行だけを見る。 */
const BLOCKED_WINDOW_MS = 24 * 3600 * 1000;

/** 1回ぶんの利用額（USD）。 */
export function estimateCost(usage, model = MODEL) {
  if (!usage) return 0;
  const price = PRICING[model] ?? PRICING[MODEL];
  const input = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  const cached = usage.cache_read_input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;

  // キャッシュから読んだぶんは1割の単価
  return (
    (input / 1e6) * price.input +
    (cached / 1e6) * price.input * 0.1 +
    (output / 1e6) * price.output
  );
}

/**
 * 残高の状況をまとめる。
 * 残高が未入力なら amount 系は null にして、課金エラーの有無だけ返す。
 */
export async function creditStatus() {
  const db = getDb();

  const [settingSnap, runsSnap] = await Promise.all([
    db.collection(SETTINGS_DOC.collection).doc(SETTINGS_DOC.id).get(),
    // 複合インデックスを避けるため、新しい順に取ってから手元で絞る
    db.collection(COLLECTIONS.runs).orderBy('startedAt', 'desc').limit(200).get(),
  ]);

  const setting = settingSnap.exists ? settingSnap.data() : null;
  const runs = runsSnap.docs.map((d) => d.data());

  // 課金で止まっていないか（直近24時間の失敗だけを見る）
  const since24h = Date.now() - BLOCKED_WINDOW_MS;
  const blocked = runs.some((r) => {
    if (r.status !== 'failed') return false;
    if (new Date(r.startedAt ?? 0).getTime() < since24h) return false;
    const text = `${r.message ?? ''} ${JSON.stringify(r.results ?? '')}`.toLowerCase();
    return BILLING_WORDS.some((w) => text.includes(w));
  });

  if (!setting?.credit) {
    return { configured: false, blocked, remaining: null, daysLeft: null, tone: blocked ? 'danger' : 'default' };
  }

  const since = setting.setAt ?? new Date(0).toISOString();
  let spent = 0;
  for (const run of runs) {
    if (run.job !== 'generate' || String(run.startedAt ?? '') < since) continue;
    for (const r of run.results ?? []) spent += estimateCost(r.usage, r.model ?? MODEL);
  }

  const remaining = Math.max(0, setting.credit - spent);
  const elapsedDays = Math.max(0.5, (Date.now() - new Date(since).getTime()) / 86400000);
  const perDay = spent / elapsedDays;
  const daysLeft = perDay > 0 ? remaining / perDay : null;

  let tone = 'ok';
  if (blocked || remaining <= 0 || (daysLeft !== null && daysLeft < DANGER_DAYS)) tone = 'danger';
  else if (daysLeft !== null && daysLeft < WARN_DAYS) tone = 'warn';

  return {
    configured: true,
    blocked,
    credit: setting.credit,
    setAt: since,
    spent,
    remaining,
    perDay,
    daysLeft,
    tone,
  };
}

/** 表示用。$12.34 の形にする。 */
export function usd(value) {
  if (value === null || value === undefined) return '-';
  return `$${value.toFixed(2)}`;
}
