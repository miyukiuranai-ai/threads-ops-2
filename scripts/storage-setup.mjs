#!/usr/bin/env node
// Firebase Storage のバケットに CORS を設定する。
//
// 画像・動画はブラウザから直接バケットへ送る（Vercel は4.5MBを超える
// リクエストを通せないため）。そのためブラウザからの PUT を許可しておく必要がある。
//
// 使い方: npm run storage:setup
import { loadEnv } from './lib/env.mjs';
import { getBucket } from '../lib/server/storage.mjs';

const ORIGINS = [
  'https://threads-ops-app.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:61799',
];

async function main() {
  loadEnv();
  const bucket = getBucket();

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
