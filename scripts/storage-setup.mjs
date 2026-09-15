#!/usr/bin/env node
// Firebase Storage のバケットに CORS を設定する。
//
// 画像・動画はブラウザから直接バケットへ送る（Vercel は4.5MBを超える
// リクエストを通せないため）。そのためブラウザからの PUT を許可しておく必要がある。
//
// 使い方: npm run storage:setup
//   許可する URL は threads-ops2 の Vercel と localhost。足すなら
//   npm run storage:setup -- --origin https://xxx.vercel.app,https://yyy.example
//   か、.env.local の APP_URL（カンマ区切り）で指定する。
import { loadEnv } from './lib/env.mjs';
import { getBucket } from '../lib/server/storage.mjs';

const DEFAULT_ORIGINS = [
  'https://threads-ops-2-rosy.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
];

function extraOrigins() {
  const out = [];
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--origin');
  if (i >= 0 && argv[i + 1]) out.push(...argv[i + 1].split(','));
  if (process.env.APP_URL) out.push(...process.env.APP_URL.split(','));
  return out.map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
}

async function main() {
  loadEnv();
  const bucket = getBucket();
  const ORIGINS = [...new Set([...DEFAULT_ORIGINS, ...extraOrigins()])];

  await bucket.setCorsConfiguration([
    {
      origin: ORIGINS,
      method: ['PUT', 'GET', 'HEAD'],
      responseHeader: ['Content-Type', 'x-goog-content-length-range'],
      maxAgeSeconds: 3600,
    },
  ]);

  const [metadata] = await bucket.getMetadata();
  console.log('バケット:', bucket.name);
  console.log('CORS:', JSON.stringify(metadata.cors, null, 2));
}

main().catch((err) => {
  console.error('\n失敗しました: ' + err.message);
  process.exit(1);
});
