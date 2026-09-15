#!/usr/bin/env node
// 名義ごとの自動返信のON/OFFと、誘導先（プロフィール/ピン止め）を設定する。
//
// 使い方:
//   npm run db:autoreply                              # 一覧
//   npm run db:autoreply -- seiran_uranai_ on         # 自動返信を有効化
//   npm run db:autoreply -- seiran_uranai_ off        # 無効化
//   npm run db:autoreply -- seiran_uranai_ link profile   # 誘導先を profile に固定
import { loadEnv } from './lib/env.mjs';
import { getDb, COLLECTIONS } from '../lib/server/firebase.mjs';

const LINK_STYLES = ['profile', 'pinned', 'both'];

async function main() {
  loadEnv();
  const db = getDb();
  const [target, action, value] = process.argv.slice(2).filter((a) => !a.startsWith('--'));

  const snap = await db.collection(COLLECTIONS.accounts).get();
  const accounts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  if (!target) {
    console.log('名義        自動返信  誘導先');
    for (const a of accounts) {
      console.log(
        `@${a.name}`.padEnd(20) + (a.autoReply ? 'ON ' : 'OFF').padEnd(10) + (a.linkStyle ?? 'both')
      );
    }
    console.log('\n変更: npm run db:autoreply -- <名義> <on|off>');
    console.log('      npm run db:autoreply -- <名義> link <profile|pinned|both>');
    return;
  }

  const needle = target.replace(/^@/, '').toLowerCase();
  const account = accounts.find((a) => (a.name ?? '').toLowerCase() === needle);
  if (!account) throw new Error(`名義 "${target}" が見つかりません。`);

  if (action === 'link') {
    if (!LINK_STYLES.includes(value)) throw new Error(`誘導先は ${LINK_STYLES.join(' / ')} のいずれかです。`);
    await db.collection(COLLECTIONS.accounts).doc(account.id).set({ linkStyle: value }, { merge: true });
    console.log(`@${account.name} の誘導先を ${value} にしました。`);
    return;
  }

  if (action !== 'on' && action !== 'off') throw new Error('on か off を指定してください。');
  await db.collection(COLLECTIONS.accounts).doc(account.id).set({ autoReply: action === 'on' }, { merge: true });
  console.log(`@${account.name} の自動返信を ${action === 'on' ? '有効' : '無効'} にしました。`);
}

main().catch((err) => {
  console.error('\n失敗しました: ' + err.message);
  process.exit(1);
});
