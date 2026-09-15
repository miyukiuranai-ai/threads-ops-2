// お手本の取り込み。npm run refs:import -- --file refs.json
// 形: [{"text":"...","category":"attract_intro","usage":"...","strength":"","weakness":"","source":""}]
import fs from 'node:fs';
import { main } from './_lib.mjs';
import { addReference } from '../lib/server/references.mjs';
main(async (args) => {
  const list = JSON.parse(fs.readFileSync(String(args.file || 'refs.json'), 'utf8'));
  let n = 0;
  for (const r of list) { await addReference({ ...r, addedBy: 'import' }); n++; }
  return { imported: n };
});
