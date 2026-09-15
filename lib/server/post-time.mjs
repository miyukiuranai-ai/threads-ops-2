// 本文に書かれた時刻と、実際に投稿される時刻を一致させるための処理。
//
// 「午前4時48分。」のように冒頭へ時刻を置く型がある。
// ところが投稿は次の理由で本文の時刻からズレる:
//   1. 予定時刻にジッター（±3〜10分）をかけている
//   2. 予定時刻を過ぎてから承認すると、その瞬間に投稿されてしまう
// 1 は投稿時に本文の時刻を実際の時刻へ書き直して合わせる。
// 2 は遅れすぎた投稿を出さない（missed にする）ことで防ぐ。

/** これ以上遅れた投稿は出さない。本文の時刻や時間帯の表現が合わなくなるため。 */
export const LATE_LIMIT_MINUTES = Number(process.env.PUBLISH_GRACE_MINUTES ?? 20);

/** 冒頭の時刻表現。午前/午後つき、◯時◯分、HH:MM の3通りを見る。 */
const TIME_PATTERNS = [
  { re: /(午前|午後)\s*(\d{1,2})\s*時\s*(\d{1,2})\s*分/, kind: 'ampm' },
  { re: /(\d{1,2})\s*時\s*(\d{1,2})\s*分/, kind: 'jp' },
  { re: /(\d{1,2}):(\d{2})/, kind: 'colon' },
];

/** "HH:MM" を分に直す。 */
export function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 日本時間の "HH:MM" を返す。 */
export function jstClock(date = new Date()) {
  const jst = new Date(date.getTime() + 9 * 3600000);
  return jst.toISOString().slice(11, 16);
}

/**
 * 本文の冒頭にある時刻を、指定の時刻へ書き直す。
 * 時刻が書かれていなければ本文をそのまま返す。
 *
 * @param {string} body 投稿本文
 * @param {string} hhmm 合わせたい時刻（"HH:MM"）
 * @returns {{ body: string, changed: boolean, from: string|null }}
 */
export function alignBodyTime(body, hhmm) {
  const text = String(body ?? '');
  const minutes = toMinutes(hhmm);
  if (!text || minutes === null) return { body: text, changed: false, from: null };

  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;

  // 書き直すのは冒頭の1行だけ。本文の途中に出てくる時刻は触らない
  const breakAt = text.indexOf('\n');
  const head = breakAt === -1 ? text : text.slice(0, breakAt);
  const rest = breakAt === -1 ? '' : text.slice(breakAt);

  for (const { re, kind } of TIME_PATTERNS) {
    const found = re.exec(head);
    if (!found) continue;

    let replacement;
    if (kind === 'ampm') {
      replacement = `${hour < 12 ? '午前' : '午後'}${hour % 12}時${minute}分`;
    } else if (kind === 'jp') {
      replacement = `${hour}時${minute}分`;
    } else {
      replacement = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }

    if (found[0] === replacement) return { body: text, changed: false, from: found[0] };
    return {
      body: head.replace(re, replacement) + rest,
      changed: true,
      from: found[0],
    };
  }

  return { body: text, changed: false, from: null };
}

/** 予定時刻から何分遅れているか。 */
export function minutesLate(scheduledAt, now = Date.now()) {
  if (!scheduledAt) return 0;
  return Math.round((now - new Date(scheduledAt).getTime()) / 60000);
}
