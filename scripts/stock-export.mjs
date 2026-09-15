#!/usr/bin/env node
// 画像ストックを、別の環境（もう1つのツール）へ持っていくために書き出す。
// 画像ファイルと、系統・説明・種類・名義・場所の印を manifest.json にまとめる。
//
// 使い方:
//   npm run stock:export                       # ./stock-export/ に書き出す
//   npm run stock:export -- --out ../stock-2   # 置き場所を変える
//
// 持っていく先では `npm run stock:import -- --from ./stock-export` で取り込む。
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { loadEnv } from './lib/env.mjs';
import { getBucket } from '../lib/server/storage.mjs';
import { listStock } from '../lib/server/stock.mjs';
import { getDb, COLLECTIONS } from '../lib/server/firebase.mjs';

function parseArgs(argv) {
  const args = { out: './stock-export' };
  for (let i = 0; i < argv.length; i += 1) if (argv[i] === '--out') args.out = argv[++i];
  return args;
}

async function main() {
  loadEnv();
  const { out } = parseArgs(process.argv.slice(2));
  const filesDir = join(out, 'files');
  mkdirSync(filesDir, { recursive: true });

  const accounts = new Map((await getDb().collection(COLLECTIONS.accounts).get()).docs.map((d) => [d.id, d.data().name]));
  const items = await listStock();
  const bucket = getBucket();
  const manifest = [];
  let downloaded = 0;

  for (const it of items) {
    const files = [];
    for (const f of it.files ?? []) {
      const name = basename(f.path);
      const dest = join(filesDir, name);
      if (!existsSync(dest)) {
        await bucket.file(f.path).download({ destination: dest });
        downloaded += 1;
      }
      files.push({ file: name, contentType: f.contentType, bytes: f.bytes });
    }
    manifest.push({
      kind: it.kind,
      genre: it.genre ?? '',
      note: it.note ?? null,
      accountName: it.accountId ? accounts.get(it.accountId) ?? null : null, // 名義は @ユーザー名で持っていく（ID は環境ごとに違う）
      placeSpecific: it.placeSpecific === true,
      files,
    });
  }
  writeFileSync(join(out, 'manifest.json'), JSON.stringify({ exportedAt: new Date().toISOString(), items: manifest }, null, 2));
  console.log(`${items.length}件（ファイル ${downloaded}個を新たに保存）を ${out} に書き出しました。`);
  console.log('持っていく先で: npm run stock:import -- --from ' + out);
}

main().catch((err) => {
  console.error('失敗しました: ' + err.message);
  process.exit(1);
});
