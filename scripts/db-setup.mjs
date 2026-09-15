// Firestore の初期化。settings と既定のテンプレートを入れる。npm run db:setup
import { main, out } from './_lib.mjs';
import { setDoc, getDoc, listDocs } from '../lib/server/firebase.mjs';
import { DEFAULT_LINES } from '../lib/server/impressions.mjs';
import { addTemplate, DEFAULT_TEMPLATES } from '../lib/server/replies.mjs';
import { nowIso } from '../lib/server/time.mjs';
main(async () => {
  if (!(await getDoc('settings', 'impressions'))) { await setDoc('settings', 'impressions', { ...DEFAULT_LINES, updatedAt: nowIso() }); out('settings/impressions を作成'); }
  if (!(await getDoc('settings', 'anthropic'))) { await setDoc('settings', 'anthropic', { balanceUsd: 0, updatedAt: nowIso() }); out('settings/anthropic を作成'); }
  const tpl = await listDocs('replyTemplates');
  if (!tpl.length) { for (const t of DEFAULT_TEMPLATES) await addTemplate(t); out(`返信テンプレート ${DEFAULT_TEMPLATES.length} 件を作成`); }
  out('完了。次に npm run storage:setup、名義の取り込み（token:import）、personas:import、refs:import。');
});
