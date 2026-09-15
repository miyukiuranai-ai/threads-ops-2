#!/usr/bin/env node
// 仕様書版（本家のコードに入れ替える前の threads-ops-2）で作ったデータを、本家の形に直す。
//   - accounts: ドキュメント ID を Threads のユーザー ID にする（本家は threadsUserId を ID に使う）
//   - replyTemplates: scope の無い古い形式のものを消す（そのあと npm run replies:import で入れ直す）
//   - settings/anthropic: balanceUsd → credit
// 何度実行しても同じ結果になる。使い方: npm run db:migrate
import { loadEnv } from './lib/env.mjs';
import { getDb } from '../lib/server/firebase.mjs';

async function main() {
  loadEnv();
  const db = getDb();
  const now = new Date().toISOString();

  const accSnap = await db.collection('accounts').get();
  for (const d of accSnap.docs) {
    const a = d.data();
    const target = a.threadsUserId ? String(a.threadsUserId) : null;
    const patch = { linkStyle: a.linkStyle ?? 'both', autoReply: a.autoReply ?? false, status: a.status ?? 'paused', updatedAt: now };
    if (target && d.id !== target) {
      await db.collection('accounts').doc(target).set({ ...a, ...patch }, { merge: true });
      // この名義を指していた投稿や履歴の accountId も付け替える
      for (const col of ['posts', 'history', 'replies', 'signups', 'testimonials', 'directives']) {
        const snap = await db.collection(col).where('accountId', '==', d.id).get();
        for (const x of snap.docs) await x.ref.set({ accountId: target }, { merge: true });
        if (snap.size) console.log(`  ${col}: ${snap.size} 件の accountId を付け替え`);
      }
      await d.ref.delete();
      console.log(`accounts: @${a.name} の ID を ${d.id} → ${target} に変更`);
    } else {
      await d.ref.set(patch, { merge: true });
      console.log(`accounts: @${a.name} はそのまま（ID ${d.id}）`);
    }
  }

  // 実体の無いキャラ設定 ID を名義から外す
  const personaIds = new Set((await db.collection('personas').get()).docs.map((d) => d.id));
  for (const d of (await db.collection('accounts').get()).docs) {
    const pid = d.data().personaId;
    if (pid && !personaIds.has(pid)) {
      await d.ref.set({ personaId: null, updatedAt: now }, { merge: true });
      console.log(`accounts: @${d.data().name} の実体の無いキャラ設定 ${pid} を外した`);
    }
  }

  const tplSnap = await db.collection('replyTemplates').get();
  let removed = 0;
  for (const d of tplSnap.docs) if (!d.data().scope) { await d.ref.delete(); removed += 1; }
  if (removed) console.log(`replyTemplates: 古い形式 ${removed} 件を削除。npm run replies:import で入れ直してください`);

  const cost = await db.collection('settings').doc('anthropic').get();
  if (cost.exists && cost.data().balanceUsd != null && cost.data().credit == null) {
    await cost.ref.set({ credit: cost.data().balanceUsd, updatedAt: now }, { merge: true });
    console.log('settings/anthropic: balanceUsd → credit');
  }
  console.log('完了');
}
main().catch((e) => { console.error('失敗しました: ' + e.message); process.exit(1); });
