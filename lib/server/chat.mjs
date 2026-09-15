// ツールの中の「相談」。
// 運用者（uta / suzuki）が同じ画面で Claude と話す。会話は Firestore に置き、全員で共有する。
// Claude には、リポジトリの方針（CLAUDE.md と docs/claude-memory）と、いまのデータ（レポート・名義の設定・監視リスト）を渡す。
// 運用者が頼めば、道具（chat-tools.mjs）でキャラ設定の変更やその日の投稿の作り直しも行う。実行の記録は会話に残す。
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { getDb, COLLECTIONS } from './firebase.mjs';
import { getClaude, MODELS } from './claude.mjs';
import { toolsFor, runTool } from './chat-tools.mjs';
import { loadReports } from './report.mjs';
import { luckyDaysFor, formatLuckyDays } from './lucky-days.mjs';
import { jstDate } from './signups.mjs';

export const CHAT_COLLECTION = 'chat_messages';
export const CHAT_THREAD = 'shared';
const HISTORY_LIMIT = 30;

function readIfExists(p) {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

/** リポジトリに置いた方針を読む（CLAUDE.md と docs/claude-memory/*.md）。 */
function loadGuidance() {
  const root = process.cwd();
  const parts = [readIfExists(path.join(root, 'CLAUDE.md'))];
  try {
    const dir = path.join(root, 'docs', 'claude-memory');
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.md') && f !== 'MEMORY.md') parts.push(readIfExists(path.join(dir, f)));
    }
  } catch {
    // メモが無くても相談は動く
  }
  return parts.filter(Boolean).join('\n\n---\n\n');
}

/** いまのデータをまとめる。長くなりすぎないように要点だけ。 */
async function loadSnapshot() {
  const db = getDb();
  const [personasSnap, accountsSnap, watchSnap, reports] = await Promise.all([
    db.collection(COLLECTIONS.personas).get(),
    db.collection(COLLECTIONS.accounts).get(),
    db.collection('watchlist').get(),
    loadReports({ limit: 1 }),
  ]);

  const accounts = accountsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const personas = personasSnap.docs.map((d) => {
    const p = d.data();
    const acc = accounts.find((a) => a.personaId === d.id);
    return [
      `- ${p.name}（@${acc?.name ?? '?'}）: 1日${p.postsPerDay ?? '-'}本、帯 ${(p.bands ?? []).join(' / ') || '-'}`,
      `  合言葉を求める本数 ${p.askPerDay ?? '指定なし'} / 骨格の使い回し ${p.reuseWinners ? 'ON' : 'OFF'}${p.winnersFrom ? `（${p.winnersFrom}〜${p.winnersTo ?? ''}）` : ''}`,
      `  構成の型 ${p.useDayPatterns === false ? 'OFF' : 'ON'} / バズ狙い1本 ${p.buzzTrial ? 'ON' : 'OFF'}（${p.buzzTone === 'light' ? 'ライト' : '通常'}） / 落ち込み中 ${p.slumpPosts ?? 1}本・${p.slumpType === 'reading_open' ? '霊視開始型' : 'バズ型'} / モデル ${p.model ?? '-'}`,
    ].join('\n');
  });

  const report = reports[0];
  let reportText = 'まだありません';
  if (report) {
    const alerts = (report.alerts ?? []).map((a) => `- [${a.level}] @${a.account} ${a.message}${a.proposal ? ` ／ 提案: ${a.proposal}` : ''}`);
    const stats = (report.stats ?? []).map((s) => {
      const trend = (s.series ?? []).map((x) => `${x.date.slice(5)} ${x.posts}本/${x.medianViews}`).join(' → ');
      const m = s.momentum && s.momentum.state !== 'unknown' ? `判定 ${s.momentum.state === 'slump' ? '落ち込み' : '通常'}（直近${s.momentum.recent}/基準${s.momentum.baseline}）` : '';
      return `- @${s.account}: 表示${s.views} 追加${s.signups ?? '未入力'} ${m}\n  推移: ${trend}`;
    });
    const acc = (report.accounts ?? []).map((a) => `- @${a.account}: 続ける ${(a.keep ?? []).join('／') || '-'} ／ やめる ${(a.stop ?? []).join('／') || '-'}${a.note ? ` ／ 気づき ${a.note}` : ''}`);
    reportText = [`対象日 ${report.date}`, report.overall ?? '', '指摘:', ...alerts, '名義:', ...stats, '続ける・やめる:', ...acc].join('\n');
  }

  const watch = watchSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.analyzedAt ?? '').localeCompare(String(a.analyzedAt ?? '')))
    .slice(0, 12)
    .map((w) => `- @${w.username}（${w.status}）${w.note ?? ''}`);

  const today = jstDate();
  const cal = formatLuckyDays(luckyDaysFor(today));

  return `## 名義の設定（いま）
${personas.join('\n')}

## 最新の日次レポート
${reportText}

## 監視リスト（最近見たもの）
${watch.join('\n') || '- なし'}

## 今日の暦
${cal}`;
}

const SYSTEM_HEAD = `あなたは、この Threads 運用ツールの中にいる相談相手です。運用者（uta と suzuki）が同じ画面で話しかけます。
- 日本語で、短く、結論から答える。専門用語を避け、運用者の言葉で話す。
- 下の「方針」は本人たちが決めたもの。これに反する提案はしない。迷ったら方針に戻る。
- 数字は渡されたものだけを使い、作らない。分からないことは分からないと言う。
- 意見や提案は積極的に出す。「いま落ち込んでいるので、明日はバズ型1本と霊視開始型1本でいきますね」のように、方針とデータから具体案を示す。
- 運用に関わることは、運用者が頼めば誰の頼みでも実行する:
  その日の投稿の操作（set_day_directive / generate_posts / list_drafts）、本文の差し替え（edit_draft）、キャラ設定の変更（update_persona）。
  本文の内容を運用者が決めたいときは、generate_posts の instruction に指示を入れるか、書いてもらった本文を edit_draft でそのまま入れる。
  ツールの仕様やコードだけは、この相談からは変えられない。頼まれたら、変えたい内容を文章にまとめて uta に渡すよう案内する。
  運用者が明確に頼んだときだけ実行する。曖昧なら、何をどう変えるかを一文で確認してから実行する。
  実行したら、何をどう変えたかを短く報告する。作り直しは費用がかかるので、頼まれていないのに作り直さない。
- 「明日」は日本時間の明日。日付の指定が無い変更は明日ぶんに対して行う。
- 発言には話し手の名前が付いている。誰の発言かを踏まえて答える。`;

export async function buildSystem() {
  const [guidance, snapshot] = await Promise.all([loadGuidance(), loadSnapshot()]);
  return `${SYSTEM_HEAD}

# 方針（リポジトリから）
${guidance}

# いまのデータ
${snapshot}`;
}

/** 共有の会話を新しい順に読む。 */
export async function loadMessages({ limit = 60 } = {}) {
  const snap = await getDb()
    .collection(CHAT_COLLECTION)
    .where('threadId', '==', CHAT_THREAD)
    .limit(500)
    .get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .slice(-limit);
}

export async function appendMessage({ role, name, text, model = null, usage = null }) {
  const doc = {
    threadId: CHAT_THREAD,
    role,
    name: name ?? null,
    text,
    model,
    usage,
    createdAt: new Date().toISOString(),
  };
  const ref = await getDb().collection(CHAT_COLLECTION).add(doc);
  return { id: ref.id, ...doc };
}

/**
 * ひとこと送って、返事をもらう。
 * @param {object} p
 * @param {string} p.text  運用者の発言
 * @param {string} p.name  話し手（uta / suzuki）
 * @param {string} [p.model]
 */
export async function ask({ text, name, model = 'claude-opus-5', ctx = null }) {
  const useModel = MODELS[model] ? model : 'claude-opus-5';
  await appendMessage({ role: 'user', name, text });

  const history = await loadMessages({ limit: HISTORY_LIMIT });
  const messages = history.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content:
      m.role === 'assistant' ? m.text : m.role === 'tool' ? `（記録）${m.text}` : `${m.name ?? '運用者'}: ${m.text}`,
  }));
  // 先頭が assistant だと API が受け付けないので、user から始まるように詰める
  while (messages.length && messages[0].role !== 'user') messages.shift();
  // 連続する同じ役割はまとめる（記録が続いたとき）
  const merged = [];
  for (const m of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content = `${last.content}\n${m.content}`;
    else merged.push({ ...m });
  }

  const system = await buildSystem();
  const client = getClaude();
  const usageSum = { input_tokens: 0, output_tokens: 0 };
  const saved = [];
  let convo = merged;

  for (let round = 0; round < 6; round += 1) {
    const res = await client.messages.create({
      model: useModel,
      max_tokens: 2000,
      system,
      tools: toolsFor(ctx?.user),
      messages: convo,
    });
    usageSum.input_tokens += res.usage?.input_tokens ?? 0;
    usageSum.output_tokens += res.usage?.output_tokens ?? 0;

    const textParts = res.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    const toolUses = res.content.filter((c) => c.type === 'tool_use');

    if (textParts) saved.push(await appendMessage({ role: 'assistant', name: 'Claude', text: textParts, model: useModel, usage: null }));
    if (!toolUses.length || res.stop_reason !== 'tool_use') break;

    const results = [];
    for (const tu of toolUses) {
      let out;
      try {
        out = await runTool(tu.name, tu.input ?? {}, ctx);
      } catch (err) {
        out = `失敗: ${err.message}`;
      }
      saved.push(await appendMessage({ role: 'tool', name: `実行（${name}）`, text: `${tu.name}: ${out}`, model: null, usage: null }));
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: out });
    }
    convo = [...convo, { role: 'assistant', content: res.content }, { role: 'user', content: results }];
  }

  if (saved.length) {
    const last = saved[saved.length - 1];
    await getDb().collection(CHAT_COLLECTION).doc(last.id).set({ usage: usageSum }, { merge: true });
  }
  return saved[saved.length - 1] ?? null;
}
