// 投稿ごとの切り替え。直前の投稿の 3 時間後判定で、これから 125 分以内に出る投稿の型を決め直す。
// 表: 悪い → 超バズ特化かバズ特化／普通 → バズ特化／良い・バズ → 属人。属人で 1,000 付いたらバズ扱いで属人を続ける。
import { listAccounts, getPersonaForAccount } from './accounts.mjs';
import { listPosts, updatePost } from './posts.mjs';
import { latestVerdict } from './impressions.mjs';
import { tierOf, SUPER_BUZZ_TYPES, normalizeType } from './post-types.mjs';
import { usableStock } from './stock.mjs';
import { generateForAccount } from './pipeline.mjs';
import { nowIso } from './time.mjs';

function nextTierFor(verdict, { canSuperBuzz, lastType }) {
  if (verdict === 'bad') return canSuperBuzz ? 'super_buzz' : 'buzz';
  if (verdict === 'normal') return 'buzz';
  return 'personal'; // good / buzz
}

export async function perPostSwitch({ now = new Date() } = {}) {
  const accounts = await listAccounts({ status: 'active' });
  const results = [];
  const until = new Date(now.getTime() + 125 * 60000).toISOString();
  for (const acc of accounts) {
    try {
      const persona = await getPersonaForAccount(acc);
      if (persona.perPostSwitch === false) continue;
      const mix = (persona.dayMix || []).map(normalizeType).filter(Boolean);
      if (mix.length && mix.every((t) => SUPER_BUZZ_TYPES.includes(t))) continue; // 超バズ特化だけの名義
      const upcoming = (await listPosts({ accountId: acc.id, statuses: ['pending', 'approved'], from: now.toISOString(), to: until, limit: 20 }))
        .filter((p) => !p.preSwitchCheckedAt && !p.lockedType && !p.switchedFrom);
      if (!upcoming.length) continue;
      const prev = await latestVerdict(acc.id, { now });
      if (!prev) {
        for (const p of upcoming) await updatePost(p.id, { preSwitchCheckedAt: nowIso(), preSwitchNote: '直前の判定なし' });
        continue;
      }
      let verdict = prev.verdict3h;
      if (tierOf(prev.type) === 'personal' && (prev.snap3h?.views || 0) >= 1000) verdict = 'buzz';
      const stock = await usableStock(acc.id);
      const canSuperBuzz = !persona.noSuperBuzz && stock.length > 0;
      const wantTier = nextTierFor(verdict, { canSuperBuzz, lastType: prev.type });
      for (const p of upcoming) {
        const curTier = tierOf(p.type);
        if (curTier === wantTier) {
          await updatePost(p.id, { preSwitchCheckedAt: nowIso(), preSwitchNote: `直前 ${verdict}: 段が同じ（${curTier}）` });
          continue;
        }
        const type = wantTier === 'super_buzz' ? 'image_buzz' : wantTier === 'buzz' ? 'buzz_engagement' : 'personal_note';
        const reason = `直前の投稿が「${verdict}」（3時間後 ${prev.snap3h?.views ?? '-'}）のため ${p.type} → ${type}`;
        const gen = await generateForAccount(acc, {
          date: p.plannedDate, types: [type], slots: [p.slot], force: false, generatedBy: 'switch',
          autoApprove: true, switchedFrom: p.id, switchReason: reason, forceStock: type === 'image_buzz', instruction: `この 1 本は投稿ごとの切り替えで作り直します。${reason}`,
        });
        await updatePost(p.id, { status: 'rejected', rejectedReason: `切り替え: ${reason}`, reviewedAt: nowIso(), editedBy: 'switch', preSwitchCheckedAt: nowIso() });
        results.push({ account: acc.name, from: p.id, to: gen.posts?.[0]?.id, type, reason, usage: gen.usage });
      }
    } catch (e) {
      results.push({ account: acc.name, error: String(e.message || e) });
    }
  }
  return results;
}
