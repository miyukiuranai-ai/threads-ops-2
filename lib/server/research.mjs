// リサーチ画面の集計: 時間帯ごと／曜日ごと／名義ごとの中央値、上位投稿。
import { listHistory, median } from './history.mjs';
import { jstParts, addDays, jstDate } from './time.mjs';

export async function aggregates(accounts, { days = 30 } = {}) {
  const from = new Date(addDays(jstDate(), -days) + 'T00:00:00+09:00').toISOString();
  const byHour = {}, byWeekday = {}, byAccount = {};
  const all = [];
  for (const acc of accounts) {
    const list = await listHistory({ accountId: acc.id, from });
    for (const h of list) {
      const v = h.metrics?.views || 0;
      const p = jstParts(new Date(h.timestamp));
      const band = `${String(Math.floor(p.hour / 3) * 3).padStart(2, '0')}-${String(Math.floor(p.hour / 3) * 3 + 3).padStart(2, '0')}`;
      (byHour[band] ||= []).push(v);
      (byWeekday[p.weekday] ||= []).push(v);
      (byAccount[acc.name] ||= []).push(v);
      all.push({ ...h, account: acc.name });
    }
  }
  const med = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { median: median(v), n: v.length }]));
  const top = all.sort((a, b) => (b.score || 0) - (a.score || 0) || (b.metrics?.views || 0) - (a.metrics?.views || 0)).slice(0, 20);
  return { byHour: med(byHour), byWeekday: med(byWeekday), byAccount: med(byAccount), top };
}
