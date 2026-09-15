// 投稿時刻の決定。
// 名義間で同時刻に投稿しないよう、保存時に ±3〜10分のランダムジッターを適用する（SPEC）。

const JITTER_MIN_MINUTES = 3;
const JITTER_MAX_MINUTES = 10;
const JST_OFFSET_MINUTES = 9 * 60;

/**
 * "YYYY-MM-DD" と "HH:MM"（日本時間）から、ジッターを適用したISO文字列（UTC）を返す。
 */
export function applyJitter(dateStr, slot, { minMinutes = JITTER_MIN_MINUTES, maxMinutes = JITTER_MAX_MINUTES } = {}) {
  const [h, m] = slot.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) throw new Error(`時刻の形式が不正です: ${slot}`);

  // 日本時間として解釈し、UTCへ直す
  const baseUtcMs = Date.parse(`${dateStr}T00:00:00Z`) + (h * 60 + m - JST_OFFSET_MINUTES) * 60000;

  const span = maxMinutes - minMinutes;
  const offsetMinutes = (minMinutes + Math.random() * span) * (Math.random() < 0.5 ? -1 : 1);

  return new Date(baseUtcMs + offsetMinutes * 60000).toISOString();
}

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

const toHHMM = (minutes) => {
  // 日付をまたぐ帯では 24:00 を超える（例: 25:10 = 翌日 01:10）。applyJitter がそのまま翌日へ直す
  const m = Math.max(0, Math.min(30 * 60 - 1, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

const randomBetween = (min, max) => min + Math.random() * (max - min);

/**
 * その日の投稿枠を組み立てる。
 * 毎日同じ時刻に投稿すると機械的に見えるため、日ごとに本数と時刻を振り直す。
 *
 * - 本数は minPosts〜maxPosts のあいだでランダム
 * - 隣り合う枠は必ず minGapMinutes 以上あける
 * - 余った時間はランダムに配分するので、毎日の並びが変わる
 * - nightAnchor を指定すると、最後の1本は必ずその時間帯に置く（実績が良い深夜帯を確保する）
 * - 時間帯に入りきらない本数は自動で減らす（間隔を削らない）
 *
 * @returns {string[]} "HH:MM" の配列（昇順）
 */
export function buildDailySlots({
  windowStart = '06:00',
  windowEnd = '23:55',
  minPosts = 3,
  maxPosts = 5,
  minGapMinutes = 120,
  nightAnchor = null,
} = {}) {
  const count = Math.floor(randomBetween(minPosts, maxPosts + 1));
  const dayStart = toMinutes(windowStart);

  let dayEnd = toMinutes(windowEnd);
  let dayCount = count;
  let anchor = null;

  // 深夜枠を先に確保し、その手前 minGap ぶんは日中の枠を置かない
  if (nightAnchor) {
    const [anchorStart, anchorEnd] = nightAnchor.split('-').map(toMinutes);
    anchor = randomBetween(anchorStart, anchorEnd);
    dayEnd = anchorStart - minGapMinutes;
    dayCount -= 1;
  }

  const span = Math.max(0, dayEnd - dayStart);

  // 間隔を守ったまま置ける本数に丸める（詰め込んで間隔を潰さない）
  const maxFit = span > 0 ? Math.floor(span / minGapMinutes) + 1 : 0;
  dayCount = Math.max(0, Math.min(dayCount, maxFit));

  const slots = [];
  if (dayCount > 0) {
    // 最低限の間隔を確保したうえで余る時間
    const slack = Math.max(0, span - (dayCount - 1) * minGapMinutes);

    // 余りを「先頭の余白 + 各枠の追加間隔 + 末尾の余白」へランダムに配分する。
    // 末尾ぶんを取ることで、最後の枠が時間帯の端に張り付かなくなる。
    const weights = Array.from({ length: dayCount + 1 }, () => Math.random());
    const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
    const extras = weights.map((w) => (w / totalWeight) * slack);

    let t = dayStart + extras[0];
    slots.push(t);
    for (let i = 1; i < dayCount; i += 1) {
      t += minGapMinutes + extras[i];
      slots.push(t);
    }
  }

  if (anchor !== null) slots.push(anchor);

  return slots.sort((a, b) => a - b).filter((m) => m < 24 * 60).map(toHHMM);
}

/** ISO文字列を日本時間の "MM/DD HH:MM" にする（表示用）。 */
export function toJstLabel(iso) {
  if (!iso) return '--:--';
  const d = new Date(new Date(iso).getTime() + JST_OFFSET_MINUTES * 60000);
  if (Number.isNaN(d.getTime())) return '--:--';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** ISO文字列から日本時間の "HH:MM" だけを返す。 */
export function toJstTime(iso) {
  const label = toJstLabel(iso);
  return label === '--:--' ? label : label.split(' ')[1];
}

// ---------- 時間帯（バンド）ごとに1本ずつ置く方式 ----------
//
// 読まれる時間は生活時間に沿っている、という前提で組む:
//   深夜（0〜5時）   眠れない人が見ている。反応が濃い
//   朝（5〜9時）     通勤・通学で見る時間
//   9〜12時          仕事や学校。ほとんど見られないので置かない
//   昼（12〜17時）   休憩時間に少し
//   夜（17〜24時）   いちばん見られる
//
// 「1つの時間帯に散らす」やり方だと昼に偏る日が出るので、帯ごとに1本と決める。
// ただし固定するとそれはそれで癖になる（毎晩きっかり深夜に出る名義、など）ので、
// 帯ごとに出現率を持たせ、その日に使う帯を毎日振り直す。

/**
 * 時間帯の指定を読む。1行に1つ、"HH:MM-HH:MM [型] [出現率%]"。
 *
 *   00:00-05:00 attract_intro 70%   深夜に属人型を、7割の日に置く
 *   05:00-09:00 90%                 型は指定せず、9割の日に置く
 *
 * 出現率を省くと100%（毎日）。型を省くと dayTypes の順番で決まる。
 */
export function parseBands(input) {
  const lines = Array.isArray(input) ? input : String(input ?? '').split(/[\n,]/);
  const bands = [];

  for (const raw of lines) {
    const line = String(raw ?? '').trim();
    if (!line) continue;

    const m = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})(?:\s+([a-z_]+))?(?:\s+(\d{1,3})\s*%)?$/.exec(line);
    if (!m) throw new Error(`時間帯の書き方が違います: ${line}（例: 00:00-05:00 attract_intro 70%）`);

    const start = toMinutes(m[1]);
    // 24:00 は「その日の終わり」として扱う。
    // ジッター（±10分）で翌日にはみ出さないよう、少し内側に寄せる
    let end = m[2] === '24:00' ? 23 * 60 + 50 : toMinutes(m[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      throw new Error(`時間帯の書き方が違います: ${line}`);
    }
    // 「21:00-01:00」のように終わりが始まりより前なら、日付をまたぐ帯（翌日の 01:00 まで）
    if (end <= start) end += 24 * 60;

    const chance = m[4] === undefined ? 1 : Math.min(100, Math.max(0, Number(m[4]))) / 100;
    bands.push({ start, end, type: m[3] ?? null, chance, label: `${m[1]}-${m[2]}` });
  }

  return bands.sort((a, b) => a.start - b.start);
}

/** 重み付きで1つ選ぶ。重みが全部0なら等確率。 */
function pickWeighted(items, weightOf) {
  const weights = items.map((x) => Math.max(0, weightOf(x)));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return Math.floor(Math.random() * items.length);

  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

/**
 * 時間帯ごとに1本ずつ投稿枠を組み立てる。
 *
 * 使う帯はその日ごとに出現率で決まる。毎日同じ帯に出ると
 * 「この名義は毎晩夜更かししている」といった癖が付いてしまうため。
 *
 * - まず帯ごとに出現率で「その日に使うか」を振る
 * - 多すぎる日は出現率の低い帯から外し、少なすぎる日は高い帯から戻す
 * - それでも足りなければ、間隔を確保できる長い帯へもう1本入れる
 * - 隣り合う枠は必ず minGapMinutes 以上あける。あけられない帯は使わない
 *
 * @returns {{ slot: string, type: string|null }[]} 昇順
 */
export function buildBandedSlots({
  bands = [],
  minPosts = 3,
  maxPosts = 5,
  minGapMinutes = 240,
} = {}) {
  if (!bands.length) return [];

  // 抽選と配置は運任せなので、本数が足りない日は何度か引き直す。
  // それでも足りなければ、いちばん本数の多かった案を使う（詰め込まない）
  let best = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const tried = tryBandedSlots({ bands, minPosts, maxPosts, minGapMinutes });
    if (tried.length >= minPosts) return tried;
    if (tried.length > best.length) best = tried;
  }
  return best;
}

function tryBandedSlots({ bands, minPosts, maxPosts, minGapMinutes }) {
  const pool = bands.map((b) => ({ ...b, chance: b.chance ?? 1 }));

  // その日に使う帯を出現率で決める
  let chosen = pool.filter((b) => Math.random() < b.chance);
  let rest = pool.filter((b) => !chosen.includes(b));

  // 多すぎる日は、出現率の低いものから外す
  while (chosen.length > maxPosts) {
    const i = pickWeighted(chosen, (b) => 1 - b.chance + 0.05);
    rest.push(chosen[i]);
    chosen.splice(i, 1);
  }

  // 少なすぎる日は、出現率の高いものから戻す
  while (chosen.length < minPosts && rest.length) {
    const i = pickWeighted(rest, (b) => b.chance + 0.05);
    chosen.push(rest[i]);
    rest.splice(i, 1);
  }

  // 帯を使い切ってもまだ足りなければ、間隔を確保できる長い帯へもう1本
  while (chosen.length < minPosts) {
    const candidate = [...chosen]
      .filter((b) => b.end - b.start >= minGapMinutes)
      .sort((a, b) => b.end - b.start - (a.end - a.start))[0];
    if (!candidate) break;
    chosen.push({ ...candidate });
  }

  chosen.sort((a, b) => a.start - b.start || a.end - b.end);

  // まずは帯の中を素直にランダムに取り、間隔を満たすまで引き直す。
  // 前から順に詰めると、後ろの帯ほど終わり際に寄ってしまうため
  // （夕方に出したぶん、夜が23時台に張り付く）。
  const free = placeFreely(chosen, minGapMinutes);
  if (free) return free;

  // どうしても満たせない日は、前から順に詰めて置けるぶんだけ置く
  return placeInOrder(chosen, minGapMinutes);
}

/** 帯の中で独立にランダムに取り、間隔を満たした案だけ採用する。 */
function placeFreely(chosen, minGapMinutes) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const picks = chosen
      .map((b) => ({ at: Math.round(randomBetween(b.start, b.end)), type: b.type }))
      .sort((a, b) => a.at - b.at);

    let ok = true;
    for (let i = 1; i < picks.length; i += 1) {
      if (picks[i].at - picks[i - 1].at < minGapMinutes) {
        ok = false;
        break;
      }
    }
    if (ok) return picks.map((p) => ({ slot: toHHMM(p.at), type: p.type }));
  }
  return null;
}

/** 前から順に詰める置き方。間隔を守れない帯は使わない（本数が減る）。 */
function placeInOrder(chosen, minGapMinutes) {
  // 後ろから「ここまでに置かないと次が置けない」上限を求める
  const latest = new Array(chosen.length);
  for (let i = chosen.length - 1; i >= 0; i -= 1) {
    latest[i] =
      i === chosen.length - 1
        ? chosen[i].end
        : Math.min(chosen[i].end, latest[i + 1] - minGapMinutes);
  }

  const slots = [];
  let prev = null;

  for (let i = 0; i < chosen.length; i += 1) {
    const earliest = prev === null ? chosen[i].start : Math.max(chosen[i].start, prev + minGapMinutes);
    if (earliest > latest[i]) continue;

    const at = Math.round(randomBetween(earliest, latest[i]));
    slots.push({ slot: toHHMM(at), type: chosen[i].type });
    prev = at;
  }

  return slots;
}
