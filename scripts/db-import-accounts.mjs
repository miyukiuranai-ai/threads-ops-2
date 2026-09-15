#!/usr/bin/env node
// 手元に保存済みの名義を Firestore の accounts コレクションへ取り込む。
// 取り込み元は accounts.local.json。空の場合は .env.local の1件を使う。
// 使い方: npm run db:import-accounts
import { loadEnv, optionalEnv } from './lib/env.mjs';
import { readAccounts, ACCOUNTS_FILE } from './lib/accounts.mjs';
import { getMe } from './lib/threads.mjs';
import { getDb, COLLECTIONS } from '../lib/server/firebase.mjs';

/** accounts.local.json → 無ければ .env.local の順に取り込み元を決める。 */
async function collectAccounts() {
  const fromFile = readAccounts();
  if (fromFile.length) return { source: ACCOUNTS_FILE, accounts: fromFile };

  const accessToken = optionalEnv('THREADS_ACCESS_TOKEN');
  const userId = optionalEnv('THREADS_USER_ID');
  if (!accessToken || !userId) return { source: null, accounts: [] };

  // .env.local にはユーザー名を持っていないので API から引く
  const me = await getMe({ accessToken, fields: 'id,username' });
  return {
    source: '.env.local',
    accounts: [
      {
        username: me.username,
        userId: me.id,
        accessToken,
        expiresAt: optionalEnv('THREADS_TOKEN_EXPIRES_AT') ?? null,
      },
    ],
  };
}

async function main() {
  loadEnv();
  const { source, accounts } = await collectAccounts();
  if (!accounts.length) {
    console.log('取り込む名義がありません。');
    console.log('先に npm run token:import でトークンを取り込んでください。');
    return;
  }
  console.log(`取り込み元: ${source}`);

  const db = getDb();
  const now = new Date().toISOString();

  for (const a of accounts) {
    const ref = db.collection(COLLECTIONS.accounts).doc(a.userId);
    const snap = await ref.get();
    const prev = snap.exists ? snap.data() : {};
    await ref.set(
      {
        name: a.username,
        threadsUserId: a.userId,
        accessToken: a.accessToken,
        tokenExpiresAt: a.expiresAt,
        personaId: prev.personaId ?? null,
        status: prev.status ?? 'active',
        createdAt: prev.createdAt ?? now,
        updatedAt: now,
      },
      { merge: true }
    );
    console.log(`  ${snap.exists ? '更新' : '追加'}  @${a.username} (id=${a.userId})`);
  }

  console.log(`\n✅ ${accounts.length}件を Firestore の accounts に取り込みました。`);
}

main().catch((err) => {
  console.error('\n失敗しました: ' + err.message);
  if (err.body) console.error(JSON.stringify(err.body, null, 2));
  process.exit(1);
});
