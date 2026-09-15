#!/usr/bin/env node
// 別の環境で書き出した画像ストック（stock-export）を、この環境のバケットと Firestore に取り込む。
//
// 使い方:
//   npm run stock:import -- --from ./stock-export
//   npm run stock:import -- --from ./stock-export --dry   # 数えるだけ
//
// 同じ画像（指紋が同じ）が既にあれば飛ばす。名義指定は @ユーザー名で照合し、無ければ「全名義で使う」にする。
import { readFileSync, existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { loadEnv } from './lib/env.mjs';
import { getBucket } from '../lib/server/storage.mjs';
import { STOCK_COLLECTION } from '../lib/server/stock.mjs';
import { getDb, COLLECTIONS } from '../lib/server/firebase.mjs';

function parseArgs(argv) {
  const args = { from: './stock-export', dry: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--from') args.from = argv[++i];
    else if (argv[i] === '--dry') args.dry = true;
  }
  return args;
}

/** 投稿の添付と同じ指紋（先頭4MBの sha256 とサイズ）。 */
function fingerprintOf(buf) {
  const head = buf.subarray(0, 4 * 1024 * 1024);
  return `${createHash('sha256').update(head).digest('hex')}-${buf.length}`;
}

async function main() {
  loadEnv();
  const { from, dry } = parseArgs(process.argv.slice(2));
  const manifestPath = join(from, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`${manifestPath} がありません。stock:export で書き出したフォルダを指定してください。`);
  const { items } = JSON.parse(readFileSync(manifestPath, 'utf8'));

  const db = getDb();
  const bucket = getBucket();
  const accountsByName = new Map((await db.collection(COLLECTIONS.accounts).get()).docs.map((d) => [d.data().name, d.id]));
  const existing = new Set();
  for (const d of (await db.collection(STOCK_COLLECTION).get()).docs) for (const f of d.data().files ?? []) existing.add(f.fingerprint);

  let added = 0;
  let skipped = 0;
  for (const it of items) {
    const files = [];
    for (const f of it.files) {
      const buf = readFileSync(join(from, 'files', f.file));
      const fingerprint = fingerprintOf(buf);
      const ext = f.contentType === 'image/png' ? 'png' : 'jpg';
      const path = `posts/stock/${fingerprint.slice(0, 16)}.${ext}`;
      files.push({ fingerprint, path, contentType: f.contentType, bytes: buf.length, buf });
    }
    if (files.some((f) => existing.has(f.fingerprint))) {
      skipped += 1;
      continue;
    }
    if (!dry) {
      for (const f of files) {
        const [exists] = await bucket.file(f.path).exists();
        if (!exists) await bucket.file(f.path).save(f.buf, { contentType: f.contentType, resumable: false });
      }
      await db.collection(STOCK_COLLECTION).doc(randomUUID()).set({
        kind: it.kind,
        genre: it.genre || 'その他',
        note: it.note ?? null,
        accountId: it.accountName ? accountsByName.get(it.accountName) ?? null : null,
        placeSpecific: it.placeSpecific === true,
        files: files.map(({ buf, ...rest }) => rest),
        addedBy: 'import',
        source: `別環境から取り込み（${from}）`,
        usedBy: {},
        usedTotal: 0,
        createdAt: new Date().toISOString(),
      });
    }
    for (const f of files) existing.add(f.fingerprint);
    added += 1;
  }
  console.log(`${dry ? '（数えるだけ）' : ''}取り込み ${added}件、同じ画像があったので飛ばした ${skipped}件。`);
}

main().catch((err) => {
  console.error('失敗しました: ' + err.message);
  process.exit(1);
});
