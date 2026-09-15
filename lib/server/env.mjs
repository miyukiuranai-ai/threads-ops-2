// 環境変数の読み出し。Next からもコマンドからも使う。
function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' && v != null ? n : d;
}

export const env = {
  get FIREBASE_PROJECT_ID() { return process.env.FIREBASE_PROJECT_ID || ''; },
  get FIREBASE_CLIENT_EMAIL() { return process.env.FIREBASE_CLIENT_EMAIL || ''; },
  get FIREBASE_PRIVATE_KEY() {
    // Vercel などに貼ったとき、前後の引用符や \n のままでも動くように整える
    let k = (process.env.FIREBASE_PRIVATE_KEY || '').trim();
    if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) k = k.slice(1, -1);
    return k.replace(/\\n/g, '\n');
  },
  get FIREBASE_STORAGE_BUCKET() { return process.env.FIREBASE_STORAGE_BUCKET || ''; },
  get ANTHROPIC_API_KEY() { return process.env.ANTHROPIC_API_KEY || ''; },
  get ADMIN_USER() { return process.env.ADMIN_USER || 'admin'; },
  get ADMIN_PASSWORD() { return process.env.ADMIN_PASSWORD || ''; },
  get MEMBERS() { return process.env.MEMBERS || ''; },
  get SESSION_SECRET() { return process.env.SESSION_SECRET || process.env.CRON_SECRET || process.env.ADMIN_PASSWORD || ''; },
  get CRON_SECRET() { return process.env.CRON_SECRET || ''; },
  get POSTING_MODE() { return process.env.POSTING_MODE || 'dry_run'; },
  get REPLY_MODE() { return process.env.REPLY_MODE || 'dry_run'; },
  get PUBLISH_GRACE_MINUTES() { return num(process.env.PUBLISH_GRACE_MINUTES, 20); },
  get AUTO_REVIEW_AT() { return process.env.AUTO_REVIEW_AT || '23:30'; },
  get INSIGHTS_COLLECT_AT() { return process.env.INSIGHTS_COLLECT_AT || '03:20'; },
  get FARMER_ACCOUNTS() { return num(process.env.FARMER_ACCOUNTS, 2); },
  get FARMER_ACCOUNTS_BY_GROUP() { return process.env.FARMER_ACCOUNTS_BY_GROUP || ''; },
  get OPS_USER() { return process.env.OPS_USER || 'suzuki'; },
  get OPS_ROLE() { return process.env.OPS_ROLE || 'member'; },
  get THREADS_APP_ID() { return process.env.THREADS_APP_ID || ''; },
  get THREADS_APP_SECRET() { return process.env.THREADS_APP_SECRET || ''; },
  get THREADS_REDIRECT_URI() { return process.env.THREADS_REDIRECT_URI || 'https://localhost/callback'; },
};

export function isPostingLive() { return env.POSTING_MODE === 'live'; }
export function isReplyLive() { return env.REPLY_MODE === 'live'; }

/** グループ別の被りしきい値。teamB:4,teamC:3 の形。 */
export function farmerThreshold(group) {
  const map = {};
  for (const part of env.FARMER_ACCOUNTS_BY_GROUP.split(',')) {
    const [g, n] = part.split(':').map((s) => s && s.trim());
    if (g && n) map[g] = num(n, env.FARMER_ACCOUNTS);
  }
  return map[group] ?? env.FARMER_ACCOUNTS;
}

/** ログイン利用者の一覧。管理者は group=null（全部見える） */
export function listUsers() {
  const users = [];
  if (env.ADMIN_PASSWORD) users.push({ user: env.ADMIN_USER, password: env.ADMIN_PASSWORD, role: 'admin', group: null });
  for (const part of env.MEMBERS.split(',')) {
    const [user, password, group] = part.split(':').map((s) => s && s.trim());
    if (user && password) users.push({ user, password, role: 'member', group: group || 'main' });
  }
  return users;
}
