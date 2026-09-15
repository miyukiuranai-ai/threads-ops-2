// 返信テンプレートの保管と選択。
import { getDb } from './firebase.mjs';
import { stripDecorations, normalizeNumbers } from './text-clean.mjs';

export const TEMPLATES_COLLECTION = 'replyTemplates';

export const KNOWN_CATEGORIES = ['通常誘導', '長文理由', '丁寧', '遅延謝罪'];

/** 深夜に来たコメントへの返信で使うカテゴリ。 */
export const NIGHT_CATEGORY = '遅延謝罪';

/** その名義で使えるテンプレートを集める（名義専用があれば共通より優先）。 */
export async function loadTemplates(accountName) {
  const snap = await getDb().collection(TEMPLATES_COLLECTION).get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const own = all.filter((t) => t.scope === accountName);
  return own.length ? own : all.filter((t) => t.scope === '_shared');
}

/**
 * 相手の表示名をテンプレートに差し込む。
 * 表示名が取得できない場合、`{name}` を含む行ごと削除する
 * （名前は行頭に単独で置かれている前提。「{name}様」の行が丸ごと消える）。
 */
export function fillName(text, displayName) {
  text = normalizeNumbers(stripDecorations(text));
  const pattern = /\{\{?name\}?\}/;
  if (!pattern.test(text)) return text;

  if (displayName) return text.replace(/\{\{?name\}?\}/g, displayName);

  return text
    .split('\n')
    .filter((line) => !pattern.test(line))
    .join('\n')
    .trim();
}

/**
 * 返信に使うテンプレートを1つ選ぶ。
 * - 深夜に来たコメントは「遅延謝罪」から選ぶ
 * - それ以外は遅延謝罪を除いたカテゴリからランダム
 * - 直近で使ったテンプレートは避ける
 *
 * @param {object} p
 * @param {Array} p.templates    loadTemplates の結果
 * @param {boolean} p.night      深夜に来たコメントか
 * @param {string[]} p.recentIds 直近で使ったテンプレートID
 * @param {string} [p.linkStyle] 'profile' | 'pinned' | 'both'（既定 both）
 */
export function pickTemplate({ templates, night, recentIds = [], linkStyle = 'both' }) {
  let pool = night
    ? templates.filter((t) => t.category === NIGHT_CATEGORY)
    : templates.filter((t) => t.category !== NIGHT_CATEGORY);

  // 深夜用が用意されていなければ通常のものにフォールバックする
  if (!pool.length) pool = templates.filter((t) => t.category !== NIGHT_CATEGORY);
  if (!pool.length) pool = templates;
  if (!pool.length) return null;

  if (linkStyle === 'profile' || linkStyle === 'pinned') {
    const filtered = pool.filter((t) => t.link === linkStyle);
    if (filtered.length) pool = filtered;
  }

  const fresh = pool.filter((t) => !recentIds.includes(t.templateId));
  const target = fresh.length ? fresh : pool;

  return target[Math.floor(Math.random() * target.length)];
}
