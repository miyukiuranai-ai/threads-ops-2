// .env.local を作る。Firebase のサービスアカウント JSON を読んで FIREBASE_* を埋め、秘密の鍵を生成する。
// npm run env:init -- --sa serviceAccount.json [--bucket xxx.firebasestorage.app] [--anthropic sk-ant-...] [--admin-user admin --admin-password xxx]
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/** --key value / --flag の引数を読む */
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next != null && !next.startsWith('--')) { out[k] = next; i++; } else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const envPath = path.join(process.cwd(), '.env.local');
const current = {};
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#')) current[m[1]] = m[2];
  }
}

const next = { ...current };
const set = (k, v) => { if (v != null && v !== '') next[k] = v; };

if (args.sa) {
  const sa = JSON.parse(fs.readFileSync(String(args.sa), 'utf8'));
  if (!sa.project_id || !sa.client_email || !sa.private_key) throw new Error('サービスアカウント JSON に project_id / client_email / private_key がありません');
  set('FIREBASE_PROJECT_ID', sa.project_id);
  set('FIREBASE_CLIENT_EMAIL', sa.client_email);
  set('FIREBASE_PRIVATE_KEY', JSON.stringify(sa.private_key)); // 改行は \n のまま、ダブルクォートで囲む
  if (!next.FIREBASE_STORAGE_BUCKET) set('FIREBASE_STORAGE_BUCKET', `${sa.project_id}.firebasestorage.app`);
}
if (args.bucket) set('FIREBASE_STORAGE_BUCKET', String(args.bucket));
if (args.anthropic) set('ANTHROPIC_API_KEY', String(args.anthropic));
if (args['admin-user']) set('ADMIN_USER', String(args['admin-user']));
if (args['admin-password']) set('ADMIN_PASSWORD', String(args['admin-password']));
if (args['threads-app-id']) set('THREADS_APP_ID', String(args['threads-app-id']));
if (args['threads-app-secret']) set('THREADS_APP_SECRET', String(args['threads-app-secret']));
if (args['redirect']) set('THREADS_REDIRECT_URI', String(args['redirect']));

const defaults = {
  ADMIN_USER: 'admin',
  ADMIN_PASSWORD: '',
  MEMBERS: '',
  SESSION_SECRET: randomBytes(24).toString('hex'),
  CRON_SECRET: randomBytes(24).toString('hex'),
  POSTING_MODE: 'dry_run',
  REPLY_MODE: 'dry_run',
  PUBLISH_GRACE_MINUTES: '20',
  AUTO_REVIEW_AT: '23:30',
  INSIGHTS_COLLECT_AT: '03:20',
  FARMER_ACCOUNTS: '2',
  FARMER_ACCOUNTS_BY_GROUP: '',
  OPS_USER: 'suzuki',
  OPS_ROLE: 'member',
  THREADS_APP_ID: '',
  THREADS_APP_SECRET: '',
  THREADS_REDIRECT_URI: 'https://localhost/callback',
  ANTHROPIC_API_KEY: '',
  FIREBASE_PROJECT_ID: '',
  FIREBASE_CLIENT_EMAIL: '',
  FIREBASE_PRIVATE_KEY: '',
  FIREBASE_STORAGE_BUCKET: '',
};
for (const [k, v] of Object.entries(defaults)) if (next[k] == null) next[k] = v;

const order = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'FIREBASE_STORAGE_BUCKET', 'ANTHROPIC_API_KEY', 'ADMIN_USER', 'ADMIN_PASSWORD', 'MEMBERS', 'SESSION_SECRET', 'CRON_SECRET', 'POSTING_MODE', 'REPLY_MODE', 'PUBLISH_GRACE_MINUTES', 'AUTO_REVIEW_AT', 'INSIGHTS_COLLECT_AT', 'FARMER_ACCOUNTS', 'FARMER_ACCOUNTS_BY_GROUP', 'OPS_USER', 'OPS_ROLE', 'THREADS_APP_ID', 'THREADS_APP_SECRET', 'THREADS_REDIRECT_URI'];
const keys = [...order, ...Object.keys(next).filter((k) => !order.includes(k))];
const lines = ['# threads-ops-2 の環境変数（git に含めない）', ...keys.map((k) => `${k}=${next[k]}`)];
fs.writeFileSync(envPath, lines.join('\n') + '\n');

const missing = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'FIREBASE_STORAGE_BUCKET', 'ANTHROPIC_API_KEY', 'ADMIN_PASSWORD'].filter((k) => !next[k]);
console.log(`.env.local を書きました: ${envPath}`);
if (missing.length) console.log(`まだ空の項目: ${missing.join(', ')}（.env.local を開いて入れてください）`);
else console.log('必須の項目はそろっています。次: npm run setup:check');
