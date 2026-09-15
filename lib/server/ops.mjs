// 運用の命令（npm run ops）。相談の道具と同じものをコマンドから使う。
import { runTool } from './chat.mjs';
import { setLines, getLines } from './impressions.mjs';
import { env } from './env.mjs';

export async function runOps(command, args) {
  const session = { user: env.OPS_USER, role: env.OPS_ROLE };
  switch (command) {
    case 'list-drafts': return runTool('list_drafts', { account: args.account, date: args.date }, session);
    case 'directive': return runTool('set_day_directive', { account: args.account, date: args.date, action: args.action || 'note', types: args.types ? String(args.types).split(',') : [], instruction: args.instruction || '' }, session);
    case 'generate': return runTool('generate_posts', { account: args.account, date: args.date, types: args.types ? String(args.types).split(',') : undefined, instruction: args.instruction }, session);
    case 'edit-draft': return runTool('edit_draft', { postId: args.id, body: args.body, keyword: args.keyword, slot: args.slot }, session);
    case 'delete-post': return runTool('delete_post', { postId: args.id, reason: args.reason }, session);
    case 'persona': {
      const input = { account: args.account };
      for (const k of ['postsPerDay', 'imagePolicy', 'model', 'buzzTone', 'characterDoc']) if (args[k] != null) input[k] = args[k];
      for (const k of ['dayMix', 'styleRules', 'ngWords']) if (args[k] != null) input[k] = String(args[k]).split(',').map((s) => s.trim()).filter(Boolean);
      for (const k of ['hasAudience', 'perPostSwitch', 'noSuperBuzz']) if (args[k] != null) input[k] = String(args[k]) === 'true';
      for (const k of ['superBuzzAfterDays', 'superBuzzOnlyAfterDays']) if (args[k] != null) input[k] = Number(args[k]);
      return runTool('update_persona', input, session);
    }
    case 'lines': {
      if (args.bad == null && args.good == null && args.buzz == null) return getLines();
      return setLines({ bad: args.bad, good: args.good, buzz: args.buzz }, env.OPS_USER);
    }
    default: throw new Error(`知らない命令: ${command}（list-drafts / directive / generate / edit-draft / delete-post / persona / lines）`);
  }
}

/** --key value / --flag の引数を読む */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next != null && !next.startsWith('--')) { out[k] = next; i++; } else out[k] = true;
    } else out._.push(a);
  }
  return out;
}
