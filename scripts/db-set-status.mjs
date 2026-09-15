#!/usr/bin/env node
// 名義の稼働状態を切り替える。paused の名義には自動投稿も自動返信も行わない。
// 使い方:
//   npm run db:status                          # 一覧表示
//   npm run db:status -- uta001012 paused      # 停止
//   npm run db:status -- uta001012 active      # 再開
import { loadEnv } from './lib/env.mjs';
import { getDb, COLLECTIONS } from '../lib/server/firebase.mjs';

const VALID = ['active', 'paused'];

async function main() {
  loadEnv();
  const db = getDb();
  const [target, status] = process.argv.slice(2).filter((a) => !a.startsWith('--'));

  const snap = await db.collection(COLLECTIONS.accounts).get();
  const accounts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  if (!target) {
    if (!accounts.length) {
      console.log('登録されている名義がありません。');
      return;
    }
    console.log('名義の稼働状態:');
    for (const a of accounts) {
      console.log(`  @${a.name}  ${a.status ?? 'active'}  (id=${a.threadsUserId})`);
    }
    console.log('\n変更するには: npm run db:status -- <ユーザー名> <active|paused>');
    return;
  }

  if (!VALID.includes(status)) {
    throw new Error(`状態は ${VALID.join(' か ')} を指定してください。`);
  }

  const needle = target.replace(/^@/, '').toLowerCase();
  const account = accounts.find(
    (a) => (a.name ?? '').toLowerCase() === needle || a.threadsUserId === target
  );
  if (!account) {
    throw new Error(
      `名義 "${target}" が見つかりません。登録済み: ${accounts.map((a) => '@' + a.name).join(', ') || 'なし'}`
    );
  }

  await db
    .collection(COLLECTIONS.accounts)
    .doc(account.id)
    .set({ status, updatedAt: new Date().toISOString() }, { merge: true });

  console.log(`@${account.name} を ${status} にしました。`);
  if (status === 'paused') {
    console.log('この名義への自動投稿・自動返信は行われません。');
  }
}

main().catch((err) => {
  console.error('\n失敗しました: ' + err.message);
  process.exit(1);
});
