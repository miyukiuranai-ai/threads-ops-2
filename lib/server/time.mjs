// 日本時間のための道具。保存は ISO（UTC）、表示と枠は JST。
const JST_OFFSET_MIN = 9 * 60;

export function nowIso() { return new Date().toISOString(); }

/** Date → JST の部品 */
export function jstParts(d = new Date()) {
  const t = new Date(d.getTime() + JST_OFFSET_MIN * 60000);
  return {
    year: t.getUTCFullYear(),
    month: t.getUTCMonth() + 1,
    day: t.getUTCDate(),
    hour: t.getUTCHours(),
    minute: t.getUTCMinutes(),
    second: t.getUTCSeconds(),
    weekday: t.getUTCDay(), // 0=日
  };
}

const p2 = (n) => String(n).padStart(2, '0');

/** JST の日付 'YYYY-MM-DD' */
export function jstDate(d = new Date()) {
  const p = jstParts(d);
  return `${p.year}-${p2(p.month)}-${p2(p.day)}`;
}

/** JST の時刻 'HH:MM' */
export function jstTime(d = new Date()) {
  const p = jstParts(d);
  return `${p2(p.hour)}:${p2(p.minute)}`;
}

/** JST の 'M/D HH:MM' などの表示 */
export function formatJst(iso, { withDate = true, withSeconds = false } = {}) {
  if (!iso) return '';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '';
  const p = jstParts(d);
  const time = `${p2(p.hour)}:${p2(p.minute)}${withSeconds ? ':' + p2(p.second) : ''}`;
  return withDate ? `${p.month}/${p.day} ${time}` : time;
}

export function formatJstFull(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = jstParts(d);
  return `${p.year}-${p2(p.month)}-${p2(p.day)} ${p2(p.hour)}:${p2(p.minute)}`;
}

/** 'YYYY-MM-DD' に日数を足す */
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + n * 86400000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${p2(dt.getUTCMonth() + 1)}-${p2(dt.getUTCDate())}`;
}

/** 'HH:MM'（25:10 のような翌日表記も可）→ 分 */
export function slotToMinutes(slot) {
  const [h, m] = String(slot).split(':').map(Number);
  return h * 60 + (m || 0);
}

export function minutesToSlot(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${p2(h)}:${p2(m)}`;
}

/** JST の日付と枠（25:10 も可）→ ISO（UTC） */
export function slotToIso(dateStr, slot) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const mins = slotToMinutes(slot);
  const t = Date.UTC(y, m - 1, d, 0, 0) + mins * 60000 - JST_OFFSET_MIN * 60000;
  return new Date(t).toISOString();
}

/** ISO → その投稿が属する plannedDate 基準の枠表記。plannedDate が無ければ JST の日付で 'HH:MM' */
export function isoToSlot(iso, plannedDate) {
  const d = new Date(iso);
  if (!plannedDate) return jstTime(d);
  const [y, m, dd] = plannedDate.split('-').map(Number);
  const base = Date.UTC(y, m - 1, dd) - JST_OFFSET_MIN * 60000;
  const mins = Math.round((d.getTime() - base) / 60000);
  if (mins < 0) return jstTime(d);
  return minutesToSlot(mins);
}

/** 25:10 → 表示用 '翌01:10' */
export function slotLabel(slot) {
  if (!slot) return '';
  const mins = slotToMinutes(slot);
  if (mins >= 1440) return `翌${minutesToSlot(mins - 1440)}`;
  return slot;
}

/** いまの JST 時刻が 'HH:MM' の直後 5 分以内か（5分おきの相乗り判定） */
export function isAround(hhmm, windowMin = 5, d = new Date()) {
  const cur = slotToMinutes(jstTime(d));
  const target = slotToMinutes(hhmm);
  return cur >= target && cur < target + windowMin;
}

export function minutesBetween(aIso, bIso) {
  return (new Date(bIso).getTime() - new Date(aIso).getTime()) / 60000;
}

export const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];
