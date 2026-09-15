// 長期トークン（60 日）の延長。10 日前から警告。
import { listAccounts, updateAccount, tokenDaysLeft } from './accounts.mjs';
import { refreshLongLivedToken } from './threads.mjs';

export async function refreshTokens({ thresholdDays = 20, force = false } = {}) {
  const accounts = await listAccounts();
  const results = [];
  for (const acc of accounts) {
    if (!acc.accessToken) continue;
    const days = await tokenDaysLeft(acc);
    if (days == null) continue;
    if (!force && days > thresholdDays) { results.push({ account: acc.name, days, skipped: true }); continue; }
    try {
      const r = await refreshLongLivedToken(acc.accessToken);
      const exp = new Date(Date.now() + (r.expiresIn || 60 * 86400) * 1000).toISOString();
      await updateAccount(acc.id, { accessToken: r.accessToken, tokenExpiresAt: exp });
      results.push({ account: acc.name, days, refreshed: true, newExpiresAt: exp });
    } catch (e) {
      results.push({ account: acc.name, days, error: String(e.message || e), warn: days <= 10 });
    }
  }
  return results;
}
