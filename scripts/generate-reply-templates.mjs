#!/usr/bin/env node
// コメントへの返信テンプレートを Persona ごとに生成し、personas/replies/ に書き出す。
// 生成後は人が読んで直せるよう、ファイルとして保存する（そのあと npm run replies:import で取り込む）。
//
// 使い方:
//   npm run replies:gen -- --account seiran_uranai_
//   npm run replies:gen -- --all
//   npm run replies:gen -- --account seiran_uranai_ --count 24
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './lib/env.mjs';
import { getDb, COLLECTIONS } from '../lib/server/firebase.mjs';
import { generateText } from '../lib/server/claude.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'personas', 'replies');

/** 返信の種類。コメントの中身で使い分ける。 */
const CATEGORIES = {
  keyword: {
    label: '合言葉・短い反応への返信',
    guide: [
      '相手は合言葉や絵文字だけを置いている。内容には触れられない',
      'お礼 → 個別に視たい意思 → プロフィールのリンクからの連絡を促す、の流れ',
      '3〜6行。短く、圧をかけない',
    ],
  },
  message: {
    label: '文章を書いた人への返信',
    guide: [
      '相手は自分の言葉で何かを書いている。ただし内容は千差万別なので、具体的な悩みには踏み込まない',
      '声をかけてくれたこと自体を受け止める言い方にする',
      'お礼 → 丁寧に視たい意思 → プロフィールのリンクからの連絡を促す、の流れ',
      '4〜8行。keyword より少し丁寧に',
    ],
  },
};

const SYSTEM = `あなたは日本のThreadsで霊視アカウントを運用する書き手です。
コメントをくれた方への返信テンプレートを作ります。

厳守事項:
- Personaの世界観・一人称・語尾を守る
- 相手の名前は {{name}} と書く（実行時に差し込む）
- 同じ書き出し・同じ言い回しを繰り返さない。全て別の入り方にする
- 誇大な断定（必ず当たる、必ず良くなる等）や、医療・投資の助言はしない
- URLは書かない。「プロフィールのリンクより」という表現で誘導する
- 絵文字は0〜2個。行末に置く
- アスタリスク（* ＊）や ✴︎ ✳️ のような記号で語を囲む強調は絶対に禁止。太字の記法も使わない。【】「」で囲うのは構わない
- 1テンプレートは200文字以内

出力は必ず次のJSON形式のみ。前後に説明文をつけない。
{"templates":["本文1","本文2","..."]}`;

function parseArgs(argv) {
  const args = { account: null, all: false, count: 20 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--account') args.account = argv[++i];
    else if (argv[i] === '--all') args.all = true;
    else if (argv[i] === '--count') args.count = Number(argv[++i]);
  }
  return args;
}

function parseTemplates(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  const raw = body.slice(start, end + 1);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = JSON.parse(raw.replace(/\\(?!["\\/bfnrtu])/g, ''));
  }
  if (!Array.isArray(parsed.templates)) throw new Error('templates 配列がありません。');
  return parsed.templates.map((t) => String(t).trim()).filter(Boolean);
}

async function generateForPersona(persona, count) {
  const sections = [];

  for (const [key, def] of Object.entries(CATEGORIES)) {
    const prompt = `## Persona
名前: ${persona.name}
${persona.characterDoc ?? ''}

文体ルール:
${(persona.styleRules ?? []).map((r) => `- ${r}`).join('\n') || '- 指定なし'}

禁止表現:
${(persona.ngWords ?? []).map((w) => `- ${w}`).join('\n') || '- 指定なし'}

## 作るもの
${def.label}のテンプレートを${count}種類。

${def.guide.map((g) => `- ${g}`).join('\n')}

${count}種類すべて、入り方も締め方も変えてください。`;

    const { text, usage } = await generateText({
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 8000,
      effort: 'high',
    });

    const templates = parseTemplates(text);
    sections.push({ key, label: def.label, templates, usage });
    console.log(`  ${def.label}: ${templates.length}件（出力${usage.output_tokens}トークン）`);
  }

  return sections;
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const db = getDb();

  const personasSnap = await db.collection(COLLECTIONS.personas).get();
  let personas = personasSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!args.all) {
    if (!args.account) throw new Error('--account で名義を指定するか、--all を付けてください。');
    personas = personas.filter((p) => p.id === args.account.replace(/^@/, ''));
    if (!personas.length) throw new Error(`Persona "${args.account}" が見つかりません。`);
  }

  mkdirSync(OUT_DIR, { recursive: true });

  for (const persona of personas) {
    console.log(`\n=== ${persona.name}（${persona.id}）===`);
    const sections = await generateForPersona(persona, args.count);

    const lines = [
      `# ${persona.name} の返信テンプレート`,
      '',
      '`{{name}}` は相手の表示名に置き換わります。',
      '内容は自由に書き換えて構いません。書き換えたら `npm run replies:import` で取り込みます。',
      '',
      `persona: ${persona.id}`,
      '',
    ];

    for (const s of sections) {
      lines.push(`## ${s.key}`, `<!-- ${s.label} -->`, '');
      for (const t of s.templates) {
        lines.push('---', t, '');
      }
    }

    const path = resolve(OUT_DIR, `${persona.id}.md`);
    writeFileSync(path, lines.join('\n'), 'utf8');
    console.log(`  → ${path}`);
  }

  console.log('\n生成しました。中身を確認・修正してから npm run replies:import を実行してください。');
}

main().catch((err) => {
  console.error('\n失敗しました: ' + err.message);
  process.exit(1);
});
