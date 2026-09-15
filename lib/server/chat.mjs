// 相談（/chat）。全員で共有する会話。道具で実行し、実行内容は会話に「実行」として残す。
import { client, pickModel, usageOf, sumUsage } from './ai.mjs';
import { chatSystem } from './prompts.mjs';
import { loadPolicy } from './policy.mjs';
import { latestReport } from './report.mjs';
import { listAccounts, getPersonaForAccount, updatePersona, resolveAccount } from './accounts.mjs';
import { listWatch } from './watchlist.mjs';
import { calendarText } from './calendar.mjs';
import { getLines, setLines } from './impressions.mjs';
import { listDocs, addDoc } from './firebase.mjs';
import { nowIso, jstDate, addDays } from './time.mjs';
import { listPosts, editPost, getPost, updatePost } from './posts.mjs';
import { setDirective } from './directives.mjs';
import { generateForAccount } from './pipeline.mjs';
import { deletePostedThread } from './publish.mjs';
import { linesToArray } from './accounts.mjs';

export const THREAD_ID = 'shared';

const TOOLS = [
  { name: 'list_drafts', description: '投稿の下書き（承認待ち・保留・承認済み）を一覧する。名義名や日付で絞れる。', input_schema: { type: 'object', properties: { account: { type: 'string', description: '名義名（@なし）。省略で全部' }, date: { type: 'string', description: 'YYYY-MM-DD。省略で今日以降' } }, additionalProperties: false } },
  { name: 'set_day_directive', description: 'その日の指示を保存する。action は rest/one/one_buzz/two/keep/mix/note。types は型キーの並び、instruction は自由文。', input_schema: { type: 'object', properties: { account: { type: 'string', description: '名義名。省略や all で全名義共通' }, date: { type: 'string' }, action: { type: 'string' }, types: { type: 'array', items: { type: 'string' } }, instruction: { type: 'string' } }, required: ['date', 'action'], additionalProperties: false } },
  { name: 'generate_posts', description: '名義の指定日ぶんの投稿を生成する（作成済みなら作り直す）。instruction で指示を添えられる。', input_schema: { type: 'object', properties: { account: { type: 'string' }, date: { type: 'string' }, types: { type: 'array', items: { type: 'string' } }, instruction: { type: 'string' } }, required: ['account'], additionalProperties: false } },
  { name: 'edit_draft', description: '下書きの本文・合言葉・時刻を直す。', input_schema: { type: 'object', properties: { postId: { type: 'string' }, body: { type: 'string' }, keyword: { type: 'string' }, slot: { type: 'string', description: 'HH:MM' } }, required: ['postId'], additionalProperties: false } },
  { name: 'delete_post', description: '投稿を消す。下書きなら却下、投稿済みなら Threads から削除する。', input_schema: { type: 'object', properties: { postId: { type: 'string' }, reason: { type: 'string' } }, required: ['postId'], additionalProperties: false } },
  { name: 'update_persona', description: '名義の設定を変える。渡した項目だけ更新する。', input_schema: { type: 'object', properties: { account: { type: 'string' }, postsPerDay: { type: 'string' }, dayMix: { type: 'array', items: { type: 'string' } }, styleRules: { type: 'array', items: { type: 'string' } }, ngWords: { type: 'array', items: { type: 'string' } }, imagePolicy: { type: 'string' }, model: { type: 'string' }, buzzTone: { type: 'string' }, hasAudience: { type: 'boolean' }, superBuzzAfterDays: { type: 'number' }, superBuzzOnlyAfterDays: { type: 'number' }, perPostSwitch: { type: 'boolean' }, noSuperBuzz: { type: 'boolean' }, characterDoc: { type: 'string' } }, required: ['account'], additionalProperties: false } },
  { name: 'set_impression_lines', description: '表示数の線（bad/good/buzz）を変える。', input_schema: { type: 'object', properties: { bad: { type: 'number' }, good: { type: 'number' }, buzz: { type: 'number' } }, additionalProperties: false } },
];

async function runTool(name, input, session) {
  const by = session?.user || 'chat';
  switch (name) {
    case 'list_drafts': {
      const acc = input.account ? await resolveAccount(input.account) : null;
      const list = await listPosts({ accountId: acc?.id, statuses: ['pending', 'held', 'approved'], plannedDate: input.date || undefined, limit: 100 });
      return list.filter((p) => input.date || p.plannedDate >= jstDate()).map((p) => ({ id: p.id, account: p.accountName, date: p.plannedDate, slot: p.slot, type: p.type, status: p.status, keyword: p.keyword, body: p.body.slice(0, 160) }));
    }
    case 'set_day_directive': {
      const acc = input.account && input.account !== 'all' ? await resolveAccount(input.account) : null;
      if (input.account && input.account !== 'all' && !acc) throw new Error('名義が見つかりません');
      return setDirective({ accountId: acc?.id || null, date: input.date, action: input.action, types: input.types || [], instruction: input.instruction || '', setBy: by });
    }
    case 'generate_posts': {
      const acc = await resolveAccount(input.account);
      if (!acc) throw new Error('名義が見つかりません');
      const r = await generateForAccount(acc, { date: input.date || addDays(jstDate(), 1), types: input.types, instruction: input.instruction, force: true, generatedBy: `chat:${by}` });
      return { account: r.account, date: r.date, count: r.count, posts: r.posts, usage: r.usage };
    }
    case 'edit_draft': {
      const p = await editPost(input.postId, { body: input.body, keyword: input.keyword, slot: input.slot }, by);
      return { id: p.id, slot: p.slot, keyword: p.keyword, body: p.body };
    }
    case 'delete_post': {
      const p = await getPost(input.postId);
      if (!p) throw new Error('投稿がありません');
      if (p.status === 'posted') { await deletePostedThread(p.id, by); return { id: p.id, deleted: 'threads' }; }
      await updatePost(p.id, { status: 'rejected', rejectedReason: input.reason || `相談で削除（${by}）`, reviewedAt: nowIso(), editedBy: by });
      return { id: p.id, deleted: 'rejected' };
    }
    case 'update_persona': {
      const acc = await resolveAccount(input.account);
      if (!acc) throw new Error('名義が見つかりません');
      const persona = await getPersonaForAccount(acc);
      const patch = { ...input };
      delete patch.account;
      await updatePersona(persona.id || acc.personaId, patch);
      return { persona: persona.id || acc.personaId, updated: Object.keys(patch) };
    }
    case 'set_impression_lines': return setLines(input, by);
    default: throw new Error(`知らない道具: ${name}`);
  }
}

export async function listMessages({ limit = 60 } = {}) {
  const list = await listDocs('chat_messages', { where: [['threadId', '==', THREAD_ID]], limit: 500 });
  return list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')).slice(-limit);
}

async function save(msg) { return addDoc('chat_messages', { threadId: THREAD_ID, createdAt: nowIso(), ...msg }); }

async function buildSystem() {
  const { policy, memory } = loadPolicy();
  const report = await latestReport();
  const accounts = await listAccounts();
  const personas = [];
  for (const a of accounts) {
    const p = await getPersonaForAccount(a);
    personas.push(`@${a.name}（${a.status}、group ${a.group || 'main'}）: ${p.name} / ${p.postsPerDay}本 / dayMix ${(p.dayMix || []).join(',') || 'なし'} / model ${p.model} / hasAudience ${p.hasAudience ? 'yes' : 'no'}`);
  }
  const watch = (await listWatch()).slice(0, 30).map((w) => `@${w.username}: ${w.status}${w.note ? ` / ${w.note}` : ''}`);
  const lines = await getLines();
  const reportText = report ? `${report.date}\n${report.overall}\n${(report.alerts || []).map((a) => `- ${a.account}: [${a.level}] ${a.message} → ${a.proposal}`).join('\n')}` : '';
  return chatSystem({ policy, memory, report: reportText, personas: personas.join('\n'), watchlist: watch.join('\n'), calendar: calendarText(jstDate()), lines });
}

/** 1 往復。ユーザーの発言を保存し、Claude に道具つきで答えさせる。 */
export async function chat({ text, session, model = 'claude-opus-5' }) {
  const name = session?.user || 'user';
  await save({ role: 'user', name, text });
  const history = await listMessages({ limit: 40 });
  const messages = [];
  for (const m of history) {
    if (m.role === 'user') messages.push({ role: 'user', content: `${m.name}: ${m.text}` });
    else if (m.role === 'assistant') messages.push({ role: 'assistant', content: m.text || '（実行）' });
    else if (m.role === 'tool') messages.push({ role: 'user', content: `（実行の記録）${m.text}` });
  }
  if (!messages.length || messages[messages.length - 1].role !== 'user') messages.push({ role: 'user', content: `${name}: ${text}` });
  const system = await buildSystem();
  const usages = [];
  let finalText = '';
  for (let round = 0; round < 6; round++) {
    const res = await client().messages.create({ model: pickModel(model), max_tokens: 4000, system, tools: TOOLS, messages, output_config: { effort: 'medium' } });
    usages.push(usageOf(res, pickModel(model)));
    const textParts = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    const toolUses = res.content.filter((b) => b.type === 'tool_use');
    if (textParts) finalText += (finalText ? '\n' : '') + textParts;
    if (res.stop_reason !== 'tool_use' || !toolUses.length) break;
    messages.push({ role: 'assistant', content: res.content });
    const results = [];
    for (const tu of toolUses) {
      let out, isError = false;
      try { out = await runTool(tu.name, tu.input || {}, session); } catch (e) { out = { error: String(e.message || e) }; isError = true; }
      const record = `${tu.name}(${JSON.stringify(tu.input || {})}) → ${JSON.stringify(out).slice(0, 1500)}`;
      await save({ role: 'tool', name: tu.name, text: record, error: isError });
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out).slice(0, 8000), is_error: isError });
    }
    messages.push({ role: 'user', content: results });
  }
  const usage = sumUsage(usages);
  await save({ role: 'assistant', name: 'Claude', text: finalText || '（返答なし）', model: pickModel(model), usage });
  return { text: finalText, usage };
}

export { TOOLS, runTool, linesToArray };
