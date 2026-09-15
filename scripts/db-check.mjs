#!/usr/bin/env node
// Firestore への読み書き疎通確認。
// 使い方: npm run db:check
import { loadEnv } from './lib/env.mjs';
import { getDb, COLLECTIONS } from '../lib/server/firebase.mjs';

async function main() {
  loadEnv();
  const db = getDb();
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const ref = db.collection('_healthcheck').doc('ping');

  console.log('[1/3] 書き込み ...');
  await ref.set({ ok: true, at: new Date().toISOString() });
  console.log('      OK');

  console.log('[2/3] 読み出し ...');
  const snap = await ref.get();
  if (!snap.exists) throw new Error('書き込んだドキュメントを読み出せませんでした。');
  console.log(`      OK  ${JSON.stringify(snap.data())}`);

  console.log('[3/3] 後片付け（削除）...');
  await ref.delete();
  console.log('      OK');

  console.log(`\n✅ Firestore への読み書きに成功しました (project=${projectId})`);

  const counts = [];
  for (const name of Object.values(COLLECTIONS)) {
    const c = await db.collection(name).count().get();
    counts.push(`${name}=${c.data().count}`);
  }
  console.log(`現在の件数: ${counts.join(', ')}`);
}

main().catch((err) => {
  console.error('\n失敗しました: ' + err.message);
  console.error('SETUP-FIREBASE.md の「7. トラブルシュート」を確認してください。');
  process.exit(1);
});
