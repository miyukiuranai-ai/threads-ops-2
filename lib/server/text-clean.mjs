// 生成文の後処理。飾り記号の除去と数字の統一。
const FULLWIDTH_DIGITS = '０１２３４５６７８９';

/** 全角数字を半角に */
export function normalizeDigits(text) {
  return String(text || '').replace(/[０-９]/g, (c) => String(FULLWIDTH_DIGITS.indexOf(c)));
}

/** アスタリスク・✴︎ ✳️ ❇️ の強調、太字記法、ハッシュタグ、URL を除く */
export function stripDecorations(text) {
  let t = String(text || '');
  // 太字・強調の記法（**語** / *語* / ＊語＊ / __語__）
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '$1');
  t = t.replace(/__([^_\n]+)__/g, '$1');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1$2');
  t = t.replace(/＊([^＊\n]+)＊/g, '$1');
  // 残った飾り記号そのもの
  t = t.replace(/[*＊]/g, '');
  t = t.replace(/[✴︎✴✳️✳❇️❇]️?/g, '');
  // ハッシュタグと URL
  t = t.replace(/(^|\s)[#＃][^\s#＃]+/g, '$1');
  t = t.replace(/https?:\/\/\S+/g, '');
  // 行末の空白、3 連続以上の空行
  t = t.split('\n').map((l) => l.replace(/[ \t]{2,}/g, ' ').replace(/[ \t　]+$/, '')).join('\n');
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

/** 本文の後処理（一括） */
export function cleanBody(text) {
  return normalizeDigits(stripDecorations(text));
}

/** 合言葉の整え。空白を落とし、null 化 */
export function cleanKeyword(k) {
  if (k == null) return null;
  const s = normalizeDigits(String(k)).replace(/[*＊「」『』【】\s]/g, '').trim();
  return s ? s : null;
}

/** 先頭行の時刻（15:30 / 15時30分 / 夜の9時 など）を実際の時刻に書き直す */
export function rewriteLeadingTime(body, hh, mm) {
  const lines = String(body || '').split('\n');
  if (!lines.length) return body;
  const H = Number(hh), M = Number(mm);
  const hm = `${H}:${String(M).padStart(2, '0')}`;
  const first = lines[0];
  let replaced = first;
  if (/\d{1,2}:\d{2}/.test(first)) {
    replaced = first.replace(/\d{1,2}:\d{2}/, hm);
  } else if (/\d{1,2}時\d{1,2}分/.test(first)) {
    replaced = first.replace(/\d{1,2}時\d{1,2}分/, `${H}時${M}分`);
  } else if (/\d{1,2}時/.test(first)) {
    const h12 = H > 12 ? H - 12 : H;
    replaced = first.replace(/\d{1,2}時/, `${/(夜|午後|夕方)/.test(first) ? h12 : H}時`);
  }
  lines[0] = replaced;
  return lines.join('\n');
}

export function charCount(text) { return Array.from(String(text || '')).length; }
export function lineCount(text) { return String(text || '').split('\n').filter((l) => l.trim()).length; }

export function sha1Hex16(text) {
  // Node の crypto を遅延で使う（Edge では呼ばれない）
  return import('node:crypto').then((c) => c.createHash('sha1').update(String(text)).digest('hex').slice(0, 16));
}

/** 合言葉の形の検査（絵文字 1 つか 2 文字以内）。土地名は除外リストに */
export function keywordLooksSimple(k) {
  if (!k) return true;
  const chars = Array.from(k);
  if (chars.length <= 2) return true;
  // 絵文字（結合含む）1 つ
  const emoji = /^\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*$/u;
  return emoji.test(k);
}
