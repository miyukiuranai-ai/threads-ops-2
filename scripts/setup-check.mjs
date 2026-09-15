// 接続を一つずつ確かめる。npm run setup:check [-- --ai]（--ai で Anthropic に 1 回だけ実際に問い合わせる。数円かかる）
import { main, out } from './_lib.mjs';
import { env } from '../lib/server/env.mjs';

const OK = '✓', NG = '✗';
const results = [];
function row(name, ok, note = '') { results.push(`${ok ? OK : NG} ${name}${note ? `  … ${note}` : ''}`); return ok; }
/** 待ちすぎない（接続先が無いと SDK が何分も再試行する） */
function withTimeout(p, ms = 20000, what = '') {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} が ${ms / 1000} 秒以内に応答しない（接続先・鍵・ネットワークを確認）`)), ms))]);
}

main(async (args) => {
  // 1. 環境変数
  const required = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'FIREBASE_STORAGE_BUCKET', 'ANTHROPIC_API_KEY', 'ADMIN_PASSWORD', 'SESSION_SECRET', 'CRON_SECRET'];
  for (const k of required) row(`環境変数 ${k}`, Boolean(process.env[k]), process.env[k] ? '' : '.env.local に入れる（npm run env:init が作る）');
  row('POSTING_MODE', true, `${env.POSTING_MODE}（live にすると実際に投稿する）`);
  if (env.FIREBASE_PRIVATE_KEY && !env.FIREBASE_PRIVATE_KEY.includes('BEGIN PRIVATE KEY')) row('FIREBASE_PRIVATE_KEY の形', false, 'サービスアカウント JSON の private_key をそのまま（npm run env:init -- --sa ファイル で自動）');

  // 2. Firestore
  let fsOk = false;
  try {
    const { db } = await import('../lib/server/firebase.mjs');
    const ref = db().collection('settings').doc('_setup_check');
    await withTimeout(ref.set({ at: new Date().toISOString() }), 20000, 'Firestore');
    const snap = await withTimeout(ref.get(), 20000, 'Firestore');
    await withTimeout(ref.delete(), 20000, 'Firestore');
    fsOk = row('Firestore 読み書き', snap.exists, `project ${env.FIREBASE_PROJECT_ID}`);
  } catch (e) {
    row('Firestore 読み書き', false, hint(e));
  }

  // 3. Storage
  try {
    const { bucket } = await import('../lib/server/firebase.mjs');
    const [exists] = await withTimeout(bucket().exists(), 20000, 'Storage');
    row('Storage バケット', exists, exists ? env.FIREBASE_STORAGE_BUCKET : `バケット ${env.FIREBASE_STORAGE_BUCKET} が見つからない。Firebase コンソール → Storage の名前を FIREBASE_STORAGE_BUCKET に`);
    if (exists) {
      const [cors] = await withTimeout(bucket().getMetadata().then((m) => [m[0]?.cors]), 20000, 'Storage');
      row('Storage CORS', Boolean(cors?.length), cors?.length ? '設定済み' : 'npm run storage:setup を実行');
    }
  } catch (e) {
    row('Storage バケット', false, hint(e));
  }

  // 4. Anthropic
  if (env.ANTHROPIC_API_KEY) {
    if (args.ai) {
      try {
        const { complete } = await import('../lib/server/ai.mjs');
        const r = await withTimeout(complete({ system: '短く答える。', user: '「準備できています」とだけ返す。', maxTokens: 30, effort: 'low' }), 60000, 'Anthropic');
        row('Anthropic API', /準備/.test(r.text) || r.text.length > 0, `${r.model} が応答`);
      } catch (e) { row('Anthropic API', false, hint(e)); }
    } else {
      row('Anthropic API', env.ANTHROPIC_API_KEY.startsWith('sk-ant-'), 'キーの形だけ確認（--ai で実際に問い合わせる）');
    }
  }

  // 5. Threads（名義のトークン）
  if (fsOk) {
    try {
      const { listAccounts, tokenDaysLeft } = await import('../lib/server/accounts.mjs');
      const { getMe } = await import('../lib/server/threads.mjs');
      const accounts = await listAccounts();
      if (!accounts.length) row('名義', false, 'まだ 0 件。npm run auth:url → auth:exchange -- --code XXX --import で追加');
      for (const a of accounts) {
        if (!a.accessToken) { row(`名義 @${a.name}`, false, 'トークン未登録'); continue; }
        try {
          const me = await withTimeout(getMe(a.accessToken), 20000, 'Threads');
          row(`名義 @${a.name}`, true, `Threads ID ${me.id}、トークン残り ${await tokenDaysLeft(a)} 日`);
        } catch (e) { row(`名義 @${a.name}`, false, hint(e)); }
      }
      const { listPersonas } = await import('../lib/server/accounts.mjs');
      const personas = await listPersonas();
      row('Persona', personas.length > 0, personas.length ? `${personas.length} 件` : '/personas で作る（または npm run personas:import）');
      const { listReferences } = await import('../lib/server/references.mjs');
      const refs = await listReferences();
      row('お手本（references）', refs.length > 0, refs.length ? `${refs.length} 本` : '/research で登録（または npm run refs:import）。無くても生成はできるが質が落ちる');
    } catch (e) { row('名義の確認', false, hint(e)); }
  }
  row('Threads アプリ（認可用）', Boolean(env.THREADS_APP_ID && env.THREADS_APP_SECRET), env.THREADS_APP_ID ? '' : 'auth:url / auth:exchange を使うなら THREADS_APP_ID / THREADS_APP_SECRET が要る（トークンを別の方法で得るなら不要）');

  out(results.join('\n'));
  const bad = results.filter((r) => r.startsWith(NG)).length;
  out(bad ? `\n${bad} 件が未完了です。` : '\nすべて通りました。npm run dev でログインし、npm run gen -- --account 名義 --dry で生成を確かめてください。');
});

function hint(e) {
  const m = String(e.message || e);
  if (/PERMISSION_DENIED|permission/i.test(m)) return `権限がない: ${m.slice(0, 120)}（サービスアカウントに「Firebase Admin SDK 管理者サービス エージェント」か編集者のロール）`;
  if (/NOT_FOUND|does not exist/i.test(m)) return `見つからない: ${m.slice(0, 120)}（Firestore / Storage を有効化したか、名前が合っているか）`;
  if (/DECODER|PEM|private key/i.test(m)) return `鍵の形が不正: ${m.slice(0, 100)}（npm run env:init -- --sa ファイル で入れ直す）`;
  if (/401|403|invalid.*key|authentication/i.test(m)) return `認証に失敗: ${m.slice(0, 120)}`;
  return m.slice(0, 160);
}
