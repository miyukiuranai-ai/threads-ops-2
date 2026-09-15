// テンプレートを JSON から。npm run replies:import -- --file templates.json
// 形: [{"accountName":null,"category":"通常誘導","text":"...","linkStyle":"profile"}]
import fs from 'node:fs';
import { main } from './_lib.mjs';
import { addTemplate } from '../lib/server/replies.mjs';
main(async (args) => {
  const list = JSON.parse(fs.readFileSync(String(args.file || 'templates.json'), 'utf8'));
  for (const t of list) await addTemplate(t);
  return { imported: list.length };
});
