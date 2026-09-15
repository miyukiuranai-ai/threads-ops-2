#!/usr/bin/env node
// references/*.md のお手本投稿を Firestore の references コレクションへ取り込む。
// ファイル形式:
//   先頭にヘッダ（category: / strength: / weakness: など）
//   以降、"---" 区切りで1投稿ずつ
//
// 使い方: npm run refs:import
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadEnv } from './lib/env.mjs';
import { getDb } from '../lib/server/firebase.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REF_DIR = resolve(ROOT, 'references');
export const REFERENCES_COLLECTION = 'references';

/** ヘッダの `key: value` を拾う。 */
function parseHeader(head) {
  const meta = {};
  for (const line of head.split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.+)$/);
    if (m) meta[m[1]] = m[2].trim();
  }
  return meta;
}

async function main() {
  loadEnv();
  const db = getDb();
  const files = readdirSync(REF_DIR).filter((f) => f.endsWith('.md'));
  if (!files.length) {
    console.log(`${REF_DIR} に .md がありません。`);
    return;
  }

  let total = 0;
  for (const file of files) {
    const raw = readFileSync(resolve(REF_DIR, file), 'utf8');
    const blocks = raw.split(/^---$/m);
    const meta = parseHeader(blocks.shift() ?? '');
    const category = meta.category ?? basename(file, '.md');

    const posts = blocks.map((b) => b.trim()).filter(Boolean);
    console.log(`${file}: category=${category} / ${posts.length}件`);

    for (const text of posts) {
      // 同じ本文を二重登録しないよう、本文のハッシュをIDにする
      const id = createHash('sha1').update(text).digest('hex').slice(0, 16);
      await db
        .collection(REFERENCES_COLLECTION)
        .doc(id)
        .set(
          {
            text,
            category,
            strength: meta.strength ?? null,
            weakness: meta.weakness ?? null,
            source: file,
            charCount: [...text].length,
            lineCount: text.split(/\r?\n/).length,
            createdAt: new Date().toISOString(),
          },
          { merge: true }
        );
      total += 1;
    }
  }

  console.log(`\n✅ ${total}件を Firestore の ${REFERENCES_COLLECTION} に取り込みました。`);
}

main().catch((err) => {
  console.error('\n失敗しました: ' + err.message);
  process.exit(1);
});
