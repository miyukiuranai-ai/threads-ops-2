// 既定の返信テンプレートを入れる。npm run replies:gen
import { main } from './_lib.mjs';
import { addTemplate, DEFAULT_TEMPLATES, listTemplates } from '../lib/server/replies.mjs';
main(async (args) => {
  const existing = await listTemplates();
  let n = 0;
  for (const t of DEFAULT_TEMPLATES) { if (!args.force && existing.some((e) => e.text === t.text)) continue; await addTemplate(t); n++; }
  return { added: n };
});
