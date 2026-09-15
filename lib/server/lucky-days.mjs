// 開運日カレンダー。生成のときに「対象日の暦」として渡す材料。
// 出どころ: 池田工芸の「2026年 開運日カレンダー」（本人指定）。data/lucky-days-2026.json に日付ごとの名前を置いている。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cache = new Map();

function loadYear(year) {
  if (cache.has(year)) return cache.get(year);
  let data = {};
  try {
    data = JSON.parse(readFileSync(path.join(ROOT, 'data', `lucky-days-${year}.json`), 'utf8'));
  } catch {
    data = {};
  }
  cache.set(year, data);
  return data;
}

/** 六曜。良し悪しの含みがあるので、暦の名前とは分けて渡す。 */
const ROKUYO = new Set(['先勝', '友引', '先負', '仏滅', '大安', '赤口']);
/** 良い日として使える名前。これ以外（不成就日など）は「避ける日」として扱う。 */
const GOOD = new Set([
  '一粒万倍日', '天赦日', '寅の日', '巳の日', '己巳の日', '甲子の日', '辰の日', '大明日', '母倉日',
  '天恩日', '神吉日', '鬼宿日', '月徳日', '天一天上', '大安',
]);

/** 投稿の1行目に置く価値のある暦。これが重なる日は、1本は暦から書き出させる。 */
const STRONG = new Set(['一粒万倍日', '天赦日', '寅の日', '巳の日', '己巳の日', '甲子の日']);

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 対象日の暦を返す。
 * @param {string} date YYYY-MM-DD
 * @returns {{date:string, weekday:string, rokuyo:string|null, good:string[], avoid:string[], moon:string|null, all:string[]}}
 */
export function luckyDaysFor(date) {
  const names = loadYear(date.slice(0, 4))[date] ?? [];
  const weekday = WEEKDAYS[new Date(`${date}T00:00:00+09:00`).getUTCDay()];
  const rokuyo = names.find((n) => ROKUYO.has(n)) ?? null;
  const moon = names.find((n) => /新月|満月/.test(n)) ?? null;
  const good = names.filter((n) => GOOD.has(n) && !ROKUYO.has(n));
  const avoid = names.filter((n) => !GOOD.has(n) && !ROKUYO.has(n) && n !== moon);
  const strong = [...names.filter((n) => STRONG.has(n)), ...(moon ? [moon] : [])];
  return { date, weekday, rokuyo, good, avoid, moon, strong, all: names };
}

/** プロンプト用の1〜3行。暦が無い日は空文字。 */
export function formatLuckyDays(info) {
  if (!info) return '';
  const [y, m, d] = info.date.split('-').map(Number);
  const head = `${y}年${m}月${d}日（${info.weekday}）`;
  const parts = [];
  if (info.rokuyo) parts.push(info.rokuyo);
  if (info.good.length) parts.push(...info.good);
  if (info.moon) parts.push(info.moon);
  const lines = [`${head}: ${parts.length ? parts.join('・') : '特に名のある暦は無い日'}`];
  if (info.avoid.length) lines.push(`避ける暦: ${info.avoid.join('・')}（良い日として書かない）`);
  return lines.join('\n');
}
