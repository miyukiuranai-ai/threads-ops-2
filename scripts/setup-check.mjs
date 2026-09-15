#!/usr/bin/env node
// 接続を一つずつ確かめる。npm run setup:check [-- --ai]（--ai で Anthropic に 1 回だけ実際に問い合わせる。数円かかる）
import { loadEnv } from './lib/env.mjs';

const OK = '✓', NG = '✗';
const results = [];
function row(name, ok, note = '') { results.push(`${ok ? OK : NG} ${name}${note ? `  … ${note}` : ''}`); return ok; }
function withTimeout(p, ms = 20000, what = '') {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} が ${ms / 1000} 秒以内に応答しない（接続先・鍵・ネットワークを確認）`)), ms))]);
}
function hint(e) {
  const m = String(e.message || e);
  if (/PERMISSION_DENIED|permission/i.test(m)) return `権限がない: ${m.slice(0, 120)}`;
  if (/NOT_FOUND|does not exist/i.test(m)) return `見つからない: ${m.slice(0, 120)}（Firestore / Storage を有効化したか、名前が合っているか）`;
  if (/DECODER|PEM|private key/i.test(m)) return `鍵の形が不正: ${m.slice(0, 100)}（npm run env:init -- --sa ファイル で入れ直す）`;
  if (/401|403|invalid.*key|authentication|UNAUTHENTICATED/i.test(m)) return `認証に失敗: ${m.slice(0, 120)}`;
  return m.slice(0, 160);
}

async function main() {
  try { loadEnv(); } catch (e) { row('.env.local', false, e.message.split('\n')[0]); }
  const args = process.argv.slice(2);
  const required = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'ANTHROPIC_API_KEY', 'ADMIN_PASSWORD', 'SESSION_SECRET', 'CRON_SECRET'];
  for (const k of required) row(`環境変数 ${k}`, Boolean(process.env[k]), process.env[k] ? '' : '.env.local に入れる（npm run env:init が作る）');
  row('環境変数 FIREBASE_STORAGE_BUCKET', true, process.env.FIREBASE_STORAGE_BUCKET || `未指定（${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app を使う）`);
  row('POSTING_MODE', true, `${process.env.POSTING_MODE || 'dry_run'}（live にすると実際に投稿する）`);

  let db = null;
  try {
    const { getDb } = await import('../lib/server/firebase.mjs');
    db = getDb();
    const ref = db.collection('_healthcheck').doc('setup-check');
    await withTimeout(ref.set({ at: new Date().toISOString() }), 20000, 'Firestore');
    await withTimeout(ref.delete(), 20000, 'Firestore');
    row('Firestore 読み書き', true, `project ${process.env.FIREBASE_PROJECT_ID}`);
  } catch (e) { db = null; row('Firestore 読み書き', false, hint(e)); }

  try {
    const { getBucket } = await import('../lib/server/storage.mjs');
    const bucket = getBucket();
    const [exists] = await withTimeout(bucket.exists(), 20000, 'Storage');
    row('Storage バケット', exists, exists ? bucket.name : `バケット ${bucket.name} が見つからない（Firebase コンソール → Storage を有効化。名前が違えば FIREBASE_STORAGE_BUCKET に）`);
    if (exists) {
      const [meta] = await withTimeout(bucket.getMetadata(), 20000, 'Storage');
      row('Storage CORS', Boolean(meta?.cors?.length), meta?.cors?.length ? '設定済み' : 'npm run storage:setup を実行');
    }
  } catch (e) { row('Storage バケット', false, hint(e)); }

  if (process.env.ANTHROPIC_API_KEY) {
    if (args.includes('--ai')) {
      try {
        const { generateText } = await import('../lib/server/claude.mjs');
        const r = await withTimeout(generateText({ system: '短く答える。', messages: [{ role: 'user', content: '「準備できています」とだけ返す。' }], maxTokens: 30, effort: 'low' }), 60000, 'Anthropic');
        row('Anthropic API', Boolean(r), '応答あり');
      } catch (e) { row('Anthropic API', false, hint(e)); }
    } else {
      row('Anthropic API', process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-'), 'キーの形だけ確認（--ai で実際に問い合わせる）');
    }
  }

  if (db) {
    try {
      const { getMe } = await import('../lib/server/threads.mjs');
      const accSnap = await db.collection('accounts').get();
      const accounts = accSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (!accounts.length) row('名義', false, 'まだ 0 件。画面の「設定」でトークンを貼って追加');
      for (const a of accounts) {
        if (!a.accessToken) { row(`名義 @${a.name}`, false, 'トークン未登録'); continue; }
        if (a.id !== String(a.threadsUserId)) { row(`名義 @${a.name}`, false, 'データの ID が古い形式。npm run db:migrate を実行'); continue; }
        try {
          const me = await withTimeout(getMe({ accessToken: a.accessToken, fields: 'id,username' }), 20000, 'Threads');
          const days = a.tokenExpiresAt ? Math.floor((new Date(a.tokenExpiresAt) - Date.now()) / 86400000) : '?';
          row(`名義 @${a.name}`, true, `Threads ID ${me.id}、トークン残り ${days} 日、状態 ${a.status}${a.personaId ? '' : '、キャラ設定なし'}`);
        } catch (e) { row(`名義 @${a.name}`, false, hint(e)); }
      }
      const personas = await db.collection('personas').count().get();
      row('Persona', personas.data().count > 0, personas.data().count ? `${personas.data().count} 件` : '/personas で作る（または personas/*.md を置いて npm run personas:import）');
      const refs = await db.collection('references').count().get();
      row('お手本（references）', refs.data().count > 0, refs.data().count ? `${refs.data().count} 本` : 'npm run refs:import（references/*.md）。無くても生成はできるが質が落ちる');
      const tpl = await db.collection('replyTemplates').get();
      const bad = tpl.docs.filter((d) => !d.data().scope).length;
      row('返信テンプレート', tpl.size > 0 && !bad, tpl.size ? (bad ? `${bad} 件が古い形式。npm run db:migrate を実行` : `${tpl.size} 件`) : 'npm run replies:import（personas/replies/*.json）');
    } catch (e) { row('名義の確認', false, hint(e)); }
  }
  row('Threads アプリ（認可用）', Boolean(process.env.THREADS_APP_ID && process.env.THREADS_APP_SECRET), process.env.THREADS_APP_ID ? '' : '画面からトークンを貼る運用なら不要');

  console.log(results.join('\n'));
  const ng = results.filter((r) => r.startsWith(NG)).length;
  console.log(ng ? `\n${ng} 件が未完了です。` : '\nすべて通りました。');
  process.exit(0);
}
main().catch((e) => { console.error('エラー:', e.message); process.exit(1); });
