// 投稿ガード。実際に Threads へ投稿してよいかを一箇所で判定する。
// 投稿を行うコードは必ずここを通すこと。

/**
 * 投稿モード。
 *   dry_run … 生成・承認・予約まで動くが、Threads API の publish は実行しない（既定）
 *   live    … 実際に投稿する
 */
export function postingMode() {
  return process.env.POSTING_MODE === 'live' ? 'live' : 'dry_run';
}

/**
 * この名義に投稿してよいか判定する。
 * @returns {{allowed: boolean, dryRun: boolean, reason: string}}
 */
export function checkPostingAllowed(account) {
  const mode = postingMode();

  if (!account) {
    return { allowed: false, dryRun: mode === 'dry_run', reason: '名義が見つかりません' };
  }
  if ((account.status ?? 'active') === 'paused') {
    return { allowed: false, dryRun: mode === 'dry_run', reason: `@${account.name} は停止中です` };
  }
  if (!account.accessToken) {
    return { allowed: false, dryRun: mode === 'dry_run', reason: `@${account.name} のトークンがありません` };
  }
  if (account.tokenExpiresAt && new Date(account.tokenExpiresAt).getTime() < Date.now()) {
    return { allowed: false, dryRun: mode === 'dry_run', reason: `@${account.name} のトークンが失効しています` };
  }
  if (mode === 'dry_run') {
    return { allowed: true, dryRun: true, reason: 'DRY_RUN のため実際には投稿しません' };
  }
  return { allowed: true, dryRun: false, reason: '' };
}
