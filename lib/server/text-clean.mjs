// 本文の掃除。
// 生成AIは強調のために「✴︎✴︎【 祈り 】✴︎✴︎」「**大丈夫**」のような飾りを付けたがるが、
// これは絶対に出さない（本人の方針）。【】「」で囲うのは構わない。
// 指示で禁止したうえで、万一混ざっても保存前にここで取り除く。

const DECOR = /[*＊✳✴❇]︎?️?/gu; // * ＊ ✳ ✴ ❇（アスタリスクとその絵文字版）

/** 飾りの記号を取り除く。空白の詰まりも直す。 */
export function stripDecorations(text) {
  if (!text) return text;
  return String(text)
    .replace(DECOR, '')
    .replace(/【\s+/g, '【')
    .replace(/\s+】/g, '】')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+$/gm, '');
}

/** 飾りが含まれているか（確認用）。 */
export function hasDecorations(text) {
  return DECOR.test(String(text ?? ''));
}

// ---------- 数の書き方 ----------
// 時刻・分・年数・回数などは 0〜9 の数字でそろえる（本人の方針）。
// 「千年」「万年」「一粒万倍日」「お一人お一人」のような言い回しの漢数字はそのまま残す。
const KANJI_DIGIT = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 「二十七」「十五」「三」のような漢数字（1〜999）を数に直す。読めなければ null。 */
function kanjiToNumber(text) {
  let total = 0;
  let current = 0;
  let any = false;
  for (const ch of text) {
    if (ch in KANJI_DIGIT) {
      current = KANJI_DIGIT[ch];
      any = true;
    } else if (ch === '十') {
      total += (current || 1) * 10;
      current = 0;
      any = true;
    } else if (ch === '百') {
      total += (current || 1) * 100;
      current = 0;
      any = true;
    } else {
      return null;
    }
  }
  return any ? total + current : null;
}

// 直すのは、数えの単位が続くときだけ。日は「三日後」のように後ろに「後」があるときだけ（「一日を終える」は残す）
const COUNT_RE = /([一二三四五六七八九十百〇零]+)(時間|時|分|秒|年|歳|回|本|件|名|割|ヶ月|か月|週間|日後)/g;

/** 時刻や数えの漢数字を 0〜9 の数字に直す。 */
export function normalizeNumbers(text) {
  if (!text) return text;
  const src = String(text);
  return src.replace(COUNT_RE, (whole, num, unit, offset) => {
    // 「それで十分です」の「十分（じゅうぶん）」は数えではない。直前に時刻や数字が無ければ残す
    if (num === '十' && unit === '分' && !/[時\d]$/.test(src.slice(0, offset))) return whole;
    const n = kanjiToNumber(num);
    if (n === null || n === 0) return whole;
    return `${n}${unit}`;
  });
}
