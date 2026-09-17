#!/usr/bin/env node
// すでに作られている投稿案のうち「画像が必要」なのに画像が無いものへ、ストックから自動で付ける（threads-ops2 で追加）。
// 生成のときは自動で付くが、この仕組みを入れる前に作られた投稿案や、在庫が無くて付かなかったものに使う。
//
// 使い方:
//   npm run stock:fill                      # 承認待ち・保留の投稿案が対象
//   npm run stock:fill -- --dry             # 数えるだけ
//   npm run stock:fill -- --account 名義    # 1 名義だけ
import { loadEnv } from './lib/env.mjs';
import { getDb, COLLECTIONS } from '../lib/server/firebase.mjs';
import { needsImage } from '../lib/server/image-need.mjs';
import { stockSummary, markStockUsed } from '../lib/server/stock.mjs';
import { attachStockForRequired } from '../lib/server/pipeline.mjs';

function parseArgs(argv) {
  const args = { dry: false, account: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dry') args.dry = true;
    else if (argv[i] === '--account') args.account = argv[++i];
  }
  return args;
}

async function main() {
  loadEnv();
  const { dry, account } = parseArgs(process.argv.slice(2));
  const db = getDb();
  const accounts = new Map((await db.collection(COLLECTIONS.accounts).get()).docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
  const snap = await db.collection(COLLECTIONS.posts).where('status', 'in', ['pending', 'held']).get();
  let done = 0, none = 0, skipped = 0;
  const genresCache = new Map();
  for (const doc of snap.docs) {
    const post = { id: doc.id, ...doc.data() };
    const acc = accounts.get(post.accountId);
    if (!acc) continue;
    if (account && acc.name !== String(account).replace(/^@/, '')) continue;
    const hasMedia = (post.media?.length ?? 0) + (post.imageUrls?.length ?? 0) > 0;
    if (hasMedia || !needsImage(post)) { skipped += 1; continue; }
    if (!genresCache.has(acc.id)) genresCache.set(acc.id, await stockSummary(acc.id));
    const record = { ...post };
    const ok = await attachStockForRequired(record, { accountId: acc.id, stockGenres: genresCache.get(acc.id) });
    if (!ok) { none += 1; console.log(`[無し] @${acc.name} ${post.slot ?? ''} 在庫が無く付けられません`); continue; }
    done += 1;
    console.log(`[${dry ? '予定' : '付けた'}] @${acc.name} ${post.slot ?? ''} [${post.type}] → ${record.imageGenre ?? ''}`);
    if (!dry) {
      await doc.ref.set({ media: record.media, stockId: record.stockId, imageKind: record.imageKind, imageGenre: record.imageGenre, imageBrief: record.imageBrief, status: record.status, holdReason: record.holdReason ?? null, updatedAt: new Date().toISOString() }, { merge: true });
      await markStockUsed(record.stockId, acc.id, post.id);
    }
  }
  console.log(`\n${dry ? '（数えるだけ）' : ''}付けた ${done}件 / 在庫なし ${none}件 / 対象外 ${skipped}件`);
}

main().catch((err) => { console.error('\n失敗しました: ' + err.message); process.exit(1); });
