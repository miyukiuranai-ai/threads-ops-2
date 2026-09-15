// 開運日カレンダー（data/lucky-days-2026.json）。
import fs from 'node:fs';
import path from 'node:path';

let cache;
function load() {
  if (cache) return cache;
  const file = path.join(process.cwd(), 'data', 'lucky-days-2026.json');
  try {
    cache = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    cache = { days: {} };
  }
  return cache;
}

/** 対象日の暦の名前一覧。無ければ [] */
export function luckyNames(dateStr) {
  const data = load();
  const d = data.days?.[dateStr];
  if (!d) return [];
  return Array.isArray(d) ? d : (d.names || []);
}

/** プロンプトに貼る文。名のある暦が無ければ null */
export function calendarText(dateStr) {
  const names = luckyNames(dateStr);
  if (!names.length) return null;
  const data = load();
  const desc = data.descriptions || {};
  return names.map((n) => `- ${n}${desc[n] ? `: ${desc[n]}` : ''}`).join('\n');
}

export function hasNamedDay(dateStr) { return luckyNames(dateStr).length > 0; }
