#!/usr/bin/env node
// personas/replies/*.json の返信テンプレートを Firestore に取り込む。
//
// ファイル名の規則:
//   _shared.json          … 全名義で共通に使う
//   <名義>.json           … その名義専用（共通より優先される）
//
// 形式: [{ id, category, link, text }] または { templates: [...] }
//   category … 通常誘導 / 長文理由 / 丁寧 / 遅延謝罪
//   link     … profile / pinned
//   text     … 本文。{name} と {{name}} は相手の表示名に置き換わる（取得できない場合はその行を削除）
//
// 使い方: npm run replies:import
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './lib/env.mjs';
import { getDb } from '../lib/server/firebase.mjs';
import { TEMPLATES_COLLECTION, KNOWN_CATEGORIES } from '../lib/server/reply-templates.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = resolve(ROOT, 'personas', 'replies');

function readTemplates(path) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  const list = Array.isArray(parsed) ? parsed : parsed.templates;
  if (!Array.isArray(list)) throw new Error(`${basename(path)}: 配列が見つかりません。`);
  return list;
}

async function main() {
  loadEnv();
  if (!existsSync(DIR)) throw new Error(`${DIR} がありません。`);

  const db = getDb();
  const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
  if (!files.length) throw new Error(`${DIR} に .json がありません。`);

  let total = 0;
  for (const file of files) {
    const scope = basename(file, '.json'); // '_shared' か 名義名
    const list = readTemplates(resolve(DIR, file));
    const counts = {};

    for (const t of list) {
      if (!t.id || !t.text) throw new Error(`${file}: id と text は必須です。`);
      const category = t.category ?? '通常誘導';
      counts[category] = (counts[category] ?? 0) + 1;

      await db
        .collection(TEMPLATES_COLLECTION)
        .doc(`${scope}__${t.id}`)
        .set(
          {
            scope,
            templateId: t.id,
            category,
            link: t.link ?? 'profile',
            text: t.text,
            hasName: /\{\{?name\}?\}/.test(t.text),
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      total += 1;
    }

    const label = scope === '_shared' ? '全名義共通' : `@${scope} 専用`;
    console.log(`${file}（${label}）: ${list.length}件`);
    for (const [c, n] of Object.entries(counts)) {
      const known = KNOWN_CATEGORIES.includes(c) ? '' : '  ← 未知のカテゴリ';
      console.log(`  ${c}: ${n}件${known}`);
    }
  }

  console.log(`\n✅ ${total}件を取り込みました。`);
}

main().catch((err) => {
  console.error('\n失敗しました: ' + err.message);
  process.exit(1);
});
