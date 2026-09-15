#!/usr/bin/env node
// personas/*.md の Persona 定義を Firestore へ取り込み、名義に紐づける。
//
// ファイル形式:
//   先頭に `key: value` のヘッダ（name / account / postingSlots / defaultTypes / styleRules / ngWords）
//   空行のあと、本文（キャラ設定全文）
//
// 使い方: npm run personas:import
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './lib/env.mjs';
import { getDb, COLLECTIONS } from '../lib/server/firebase.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = resolve(ROOT, 'personas');

const LIST_KEYS = ['postingSlots', 'defaultTypes', 'dayTypes', 'styleRules', 'ngWords'];

/** ヘッダ部分（最初の空行まで）を key: value として読む。 */
function parse(raw) {
  const lines = raw.split(/\r?\n/);
  const meta = {};
  let i = 0;
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) break;
    const m = line.match(/^([a-zA-Z]+):\s*(.*)$/);
    if (!m) break;
    const [, key, value] = m;
    meta[key] = LIST_KEYS.includes(key)
      ? value
          .split(key === 'styleRules' || key === 'ngWords' ? '/' : ',')
          .map((s) => s.trim())
          .filter(Boolean)
      : value.trim();
  }
  return { meta, body: lines.slice(i).join('\n').trim() };
}

async function main() {
  loadEnv();
  const db = getDb();
  const files = readdirSync(DIR).filter((f) => f.endsWith('.md'));
  if (!files.length) {
    console.log(`${DIR} に .md がありません。`);
    return;
  }

  const accSnap = await db.collection(COLLECTIONS.accounts).get();
  const accounts = accSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  for (const file of files) {
    const { meta, body } = parse(readFileSync(resolve(DIR, file), 'utf8'));
    const personaId = basename(file, '.md');
    if (!meta.name) throw new Error(`${file}: name: が必要です。`);

    await db
      .collection(COLLECTIONS.personas)
      .doc(personaId)
      .set(
        {
          name: meta.name,
          characterDoc: body,
          styleRules: meta.styleRules ?? [],
          ngWords: meta.ngWords ?? [],
          postingSlots: meta.postingSlots ?? [],
          lineUrl: meta.lineUrl ?? null,
          postsPerDay: meta.postsPerDay ?? null,
          activeWindow: meta.activeWindow ?? null,
          minGap: meta.minGap ?? null,
          nightAnchor: meta.nightAnchor ?? null,
          nightType: meta.nightType ?? null,
          dayTypes: meta.dayTypes ?? [],
          imagePolicy: meta.imagePolicy ?? 'sometimes',
          defaultTypes: meta.defaultTypes ?? [],
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    console.log(`Persona: ${personaId}（${meta.name}）を保存`);

    if (meta.account) {
      const account = accounts.find(
        (a) => (a.name ?? '').toLowerCase() === meta.account.replace(/^@/, '').toLowerCase()
      );
      if (!account) {
        console.log(`  ⚠ 名義 @${meta.account} が未登録のため紐づけをスキップしました。`);
      } else {
        await db
          .collection(COLLECTIONS.accounts)
          .doc(account.id)
          .set({ personaId, updatedAt: new Date().toISOString() }, { merge: true });
        console.log(`  → @${account.name} に紐づけ`);
      }
    }
  }
}

main().catch((err) => {
  console.error('\n失敗しました: ' + err.message);
  process.exit(1);
});
