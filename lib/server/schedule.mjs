// 投稿枠の決定。bands から出現率で帯を選び、最短の間隔を満たすように帯の中でランダムに置く。
import { slotToMinutes, minutesToSlot } from './time.mjs';
import { normalizeType } from './post-types.mjs';

export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** 'HH:MM-HH:MM [型] [NN%]' → {start,end,type,rate} 分。日付をまたぐ 21:00-01:00 も可 */
export function parseBand(str) {
  const m = String(str || '').trim().match(/^(\d{1,2}:\d{2})\s*[-〜~]\s*(\d{1,2}:\d{2})(?:\s+(\S+?))?(?:\s+(\d{1,3})%)?$/);
  if (!m) return null;
  let start = slotToMinutes(m[1]);
  let end = slotToMinutes(m[2]);
  if (end === 0 || end <= start) end += 1440; // 24:00 / 日跨ぎ
  if (end === 1440 && m[2] === '24:00') end = 1430; // 24:00 は 23:50 扱い
  let type = null, rate = 100;
  if (m[3] && /^\d+%$/.test(m[3])) rate = Number(m[3].slice(0, -1));
  else if (m[3]) type = normalizeType(m[3]);
  if (m[4]) rate = Number(m[4]);
  return { start, end, type, rate: Math.max(0, Math.min(100, rate)), raw: str };
}

export function parseBands(list) {
  return (list || []).map(parseBand).filter(Boolean);
}

export function parseRange(str, dflt) {
  const m = String(str || '').match(/(\d+)\s*[-〜~]\s*(\d+)/);
  if (m) return [Number(m[1]), Number(m[2])];
  const n = Number(str);
  if (Number.isFinite(n) && String(str).trim() !== '') return [n, n];
  return dflt;
}

export function pickInRange(range, random = Math.random) {
  const [a, b] = range;
  return a + Math.floor(random() * (b - a + 1));
}

function activeWindowRange(persona) {
  const m = String(persona.activeWindow || '00:00-23:59').match(/(\d{1,2}:\d{2})\s*[-〜~]\s*(\d{1,2}:\d{2})/);
  if (!m) return [0, 1439];
  let s = slotToMinutes(m[1]);
  let e = slotToMinutes(m[2]);
  if (e <= s) e += 1440;
  return [s, e];
}

/**
 * 枠を決める。返り値 [{slot:'HH:MM', type, band}] 時刻順。
 * count 本。帯を出現率で選び、最短の間隔を満たすようにランダム配置（40 回引き直し、だめなら前から詰める）。
 */
export function pickSlots(persona, count, { random = Math.random } = {}) {
  if (count <= 0) return [];
  const bands = parseBands(persona.bands);
  const [gapMin, gapMax] = parseRange(persona.minGap, [180, 300]);
  const minGap = pickInRange([gapMin, gapMax], random);

  // 帯が無ければ旧方式: postingSlots / activeWindow
  if (!bands.length) {
    return legacySlots(persona, count, { random, minGap });
  }

  // 出現率で使う帯を選ぶ（少なくとも count 本ぶん）
  let chosen = bands.filter((b) => random() * 100 < b.rate);
  if (chosen.length < count) {
    const rest = bands.filter((b) => !chosen.includes(b)).sort(() => random() - 0.5);
    while (chosen.length < count && rest.length) chosen.push(rest.shift());
  }
  chosen = chosen.sort((a, b) => a.start - b.start);
  // 帯が本数より多ければ間引く（均等）
  if (chosen.length > count) {
    const step = chosen.length / count;
    chosen = Array.from({ length: count }, (_, i) => chosen[Math.floor(i * step)]);
  }
  // 帯が足りなければ同じ帯を繰り返す
  while (chosen.length < count) chosen.push(chosen[chosen.length % Math.max(1, chosen.length)] || bands[0]);

  for (let attempt = 0; attempt < 40; attempt++) {
    const picks = chosen.map((b) => ({ min: b.start + Math.floor(random() * Math.max(1, b.end - b.start)), band: b })).sort((a, b) => a.min - b.min);
    let ok = true;
    for (let i = 1; i < picks.length; i++) if (picks[i].min - picks[i - 1].min < minGap) { ok = false; break; }
    if (ok) return finalize(picks, random);
  }
  // 前から詰める
  const picks = [];
  let cursor = -Infinity;
  for (const b of chosen) {
    let min = Math.max(b.start, cursor + minGap);
    if (min >= b.end) min = Math.max(b.start, b.end - 1);
    picks.push({ min, band: b });
    cursor = min;
  }
  return finalize(picks, random);
}

/** ジッター ±3〜10 分をかけ、'HH:MM' に。日付をまたぐ帯は 25:10 のように表す */
function finalize(picks, random) {
  const out = picks.map((p) => {
    const sign = random() < 0.5 ? -1 : 1;
    const jitter = sign * (3 + Math.floor(random() * 8));
    let min = p.min + jitter;
    min = Math.max(0, Math.min(1440 + 300, min));
    // 24:00 は 23:50 扱い
    if (min === 1440) min = 1430;
    return { min, type: p.band?.type || null, band: p.band?.raw || null };
  }).sort((a, b) => a.min - b.min);
  // 同じ分にぶつかったらずらす
  for (let i = 1; i < out.length; i++) if (out[i].min <= out[i - 1].min) out[i].min = out[i - 1].min + 5;
  return out.map((o) => ({ slot: minutesToSlot(o.min), type: o.type, band: o.band }));
}

function legacySlots(persona, count, { random, minGap }) {
  const fixed = (persona.postingSlots || []).filter(Boolean);
  if (fixed.length >= count) {
    const picked = fixed.slice(0, count).map((s) => ({ min: slotToMinutes(s), band: null }));
    return finalize(picked, random);
  }
  const [s, e] = activeWindowRange(persona);
  for (let attempt = 0; attempt < 40; attempt++) {
    const picks = Array.from({ length: count }, () => ({ min: s + Math.floor(random() * Math.max(1, e - s)), band: null })).sort((a, b) => a.min - b.min);
    let ok = true;
    for (let i = 1; i < picks.length; i++) if (picks[i].min - picks[i - 1].min < minGap) { ok = false; break; }
    if (ok) return finalize(picks, random);
  }
  const picks = [];
  for (let i = 0; i < count; i++) picks.push({ min: Math.min(e - 1, s + i * Math.max(minGap, Math.floor((e - s) / count))), band: null });
  return finalize(picks, random);
}
