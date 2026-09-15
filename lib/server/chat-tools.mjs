// 相談のチャットから実行できる操作。
// 運用者が「名義◯◯は明日1本にして」「◯◯は合言葉を求める本数を2にして」と頼んだときに、Claude がここを呼ぶ。
// できることを絞り、値は必ず検証する。実行した内容は会話に記録として残す。
import { getDb, COLLECTIONS } from './firebase.mjs';
import { parseBands } from './schedule.mjs';
import { MODELS } from './claude.mjs';
import { POST_TYPES } from './generate.mjs';
import { generateForAccount, tomorrowJst } from './pipeline.mjs';
import { applyDirective, rejectDraftsFor } from './directive-apply.mjs';
import { DIRECTIVE_ACTIONS } from './directives.mjs';
import { stripDecorations, normalizeNumbers } from './text-clean.mjs';
import { deletePostedPost } from './post-delete.mjs';
import { loadLines, saveLines } from './impressions.mjs';

const jstOf = (iso) => new Date(new Date(iso).getTime() + 9 * 3600000);

/** 名義を、@ユーザー名か Persona の名前で探す。 */
async function findAccount(nameLike, allowed) {
  const key = String(nameLike ?? '').replace(/^@/, '').trim();
  if (!key) throw new Error('名義を指定してください。');
  const db = getDb();
  const personasSnap = await db.collection(COLLECTIONS.personas).get();
  const personas = new Map(personasSnap.docs.map((d) => [d.id, d.data()]));
  const hit = allowed.find((a) => {
    const p = personas.get(a.personaId) ?? {};
    return a.name === key || a.name.toLowerCase() === key.toLowerCase() || p.name === key || (p.name ?? '').replace(/\s/g, '') === key.replace(/\s/g, '');
  });
  if (!hit) throw new Error(`名義「${key}」が見つかりません。扱える名義: ${allowed.map((a) => `@${a.name}`).join(', ')}`);
  return { ...hit, persona: personas.get(hit.personaId) ?? null };
}

/** Claude に渡す道具の定義。 */
export const TOOLS = [
  {
    name: 'update_persona',
    description:
      '名義のキャラ設定を変える。運用者が明確に頼んだときだけ使う。変えられるのは本数・帯・合言葉の本数・バズ狙い・落ち込み時の設定・骨格の使い回し・モデル・書き方のきまり。人物設定（characterDoc）は変えない。',
    input_schema: {
      type: 'object',
      properties: {
        account: { type: 'string', description: '名義。@ユーザー名か名前（例: uta001012, 星蘭）' },
        postsPerDay: { type: 'string', description: '1日の本数。"3" や "3-4"' },
        askPerDay: { type: 'string', description: '合言葉を求める本数。"2-3" など。空文字で「毎回求める」' },
        minGap: { type: 'string', description: '最短の間隔（分）。"180-300" など' },
        bands: { type: 'array', items: { type: 'string' }, description: '時間帯の枠。"21:00-01:00" "04:00-09:00 80%" のような行の配列' },
        buzzTrial: { type: 'boolean', description: 'バズ狙いを1日1本入れる' },
        buzzTone: { type: 'string', enum: ['normal', 'light'], description: 'バズ型の強さ' },
        autoDeleteFlops: { type: 'boolean', description: '24時間で反応0のバズ型を自動で消す' },
        noSuperBuzz: { type: 'boolean', description: '超バズ特化型を使わない名義（一度上がった名義）。レポートの提案がバズ特化型での立て直しになる' },
        slumpBuzz: { type: 'boolean', description: '落ち込み中に1本をブーストの型にする' },
        slumpPosts: { type: 'integer', minimum: 1, maximum: 3, description: '落ち込み中の本数' },
        superBuzzAfterDays: { type: 'integer', minimum: 0, maximum: 7, description: '何日つづけて3時間後の表示が1,000に届かなかったら超バズ特化型を1本入れるか（既定2。0で入れない）' },
        hasAudience: { type: 'boolean', description: '集客（LINE追加）が来ている名義。true なら落ちても超バズだけにはせず、超バズ＋属人＋バズ特化にする（LINE追加や1,000以上の投稿が直近30日にあれば自動で同じ扱い）' },
        superBuzzOnlyAfterDays: { type: 'integer', minimum: 0, maximum: 7, description: '何日つづけて表示が300に届かなかったら、その日は超バズ特化型だけにするか（既定3。0で止める）' },
        slumpType: { type: 'string', enum: ['buzz_engagement', 'reading_open'], description: '落ち込み中のブーストの型' },
        useDayPatterns: { type: 'boolean', description: '1日の構成の型を使う' },
        reuseWinners: { type: 'boolean', description: '当たった投稿の骨格を使い回す' },
        winnersFrom: { type: 'string', description: '手本にする期間の始まり YYYY-MM-DD' },
        winnersTo: { type: 'string', description: '手本にする期間の終わり YYYY-MM-DD' },
        dayMix: { type: 'array', items: { type: 'string', enum: Object.keys(POST_TYPES) }, description: 'いまの要望の構成（変えるまで続く）。例: ["buzz_engagement","buzz_engagement","attract_intro"]＝バズ2本＋属人1本。空配列で解除して大元のルールに戻す。1日だけ変えるなら set_day_directive の mix を使う' },
        model: { type: 'string', enum: Object.keys(MODELS), description: '文章を作るモデル' },
        styleRulesAdd: { type: 'array', items: { type: 'string' }, description: '書き方のきまりに足す行' },
        styleRulesRemove: { type: 'array', items: { type: 'string' }, description: '書き方のきまりから消す行（部分一致）' },
      },
      required: ['account'],
    },
  },
  {
    name: 'set_day_directive',
    description:
      'ある日の投稿を「休む／1本／1本バズ／2本／そのまま」にする（落ち込みの自動判定より優先）。regenerate が true ならその日ぶんの下書きをその場で作り直す（数十秒・数円〜十数円）。',
    input_schema: {
      type: 'object',
      properties: {
        account: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD。省略すると明日' },
        action: { type: 'string', enum: Object.keys(DIRECTIVE_ACTIONS), description: 'rest=休む / one=1本 / one_buzz=1本バズ / two=2本 / keep=そのまま / mix=構成を指定（types が要る）' },
        types: { type: 'array', items: { type: 'string', enum: Object.keys(POST_TYPES) }, description: 'action が mix のときの構成。例: ["buzz_engagement","attract_intro"]＝バズ1本＋属人1本。バズ型は早い枠、属人型は遅い枠に入る' },
        regenerate: { type: 'boolean', description: '下書きを作り直すか。既定 true' },
        instruction: { type: 'string', description: 'その日の生成に渡す文章の指示（任意）。action=note なら本数や型は変えず指示だけ渡す' },
      },
      required: ['account', 'action'],
    },
  },
  {
    name: 'list_drafts',
    description: 'ある日の下書き（承認待ち・承認済み）を一覧する。時刻・型・合言葉・冒頭。',
    input_schema: {
      type: 'object',
      properties: {
        account: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD。省略すると明日' },
      },
      required: ['account'],
    },
  },
  {
    name: 'generate_posts',
    description:
      'ある日に、型と時刻を指定して投稿を作る。replace が true ならその日の既存の下書きを却下してから作る。false なら足す。運用者が「◯◯系のツイートにしたい」「朝に属人型を1本足して」と頼んだときに使う。費用は1回数円〜十数円。',
    input_schema: {
      type: 'object',
      properties: {
        account: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD。省略すると明日' },
        types: { type: 'array', items: { type: 'string', enum: Object.keys(POST_TYPES) }, description: '枠ごとの型' },
        slots: { type: 'array', items: { type: 'string' }, description: '枠ごとの時刻 HH:MM（日本時間）。types と同じ数' },
        replace: { type: 'boolean', description: '既存の下書きを却下して置き換えるか。既定 false' },
        instruction: {
          type: 'string',
          description:
            '本文に反映する指示（任意）。例: 「合図は🙏。暦は使わない」「名乗りは短く、貴船の由来を1行だけ」「昨日の23時の投稿と同じ骨格で」。運用者が本文の内容を決めたいときに使う',
        },
      },
      required: ['account', 'types', 'slots'],
    },
  },
  {
    name: 'delete_post',
    description:
      '投稿済みの投稿を Threads から消す（戻せない。費用はかからない）。運用者が明確に「消して」と言ったときだけ使う。日付と時刻（HH:MM）で指定する。',
    input_schema: {
      type: 'object',
      properties: {
        account: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD。省略すると今日' },
        time: { type: 'string', description: '投稿の予定時刻 HH:MM（日本時間）' },
      },
      required: ['account', 'time'],
    },
  },
  {
    name: 'set_impression_lines',
    description:
      '表示数の「良い・悪い」の線（全名義共通の絶対値）を見る・変える。3時間後の表示が bad未満=悪い、good以上=良い、buzz以上=バズ。何も渡さなければ今の線を返す。',
    input_schema: {
      type: 'object',
      properties: {
        bad: { type: 'number', description: 'これ未満なら「悪い」（既定 300）' },
        good: { type: 'number', description: 'これ以上なら「良い」（既定 1000）' },
        buzz: { type: 'number', description: 'これ以上なら「バズ」（既定 3000）' },
      },
    },
  },
  {
    name: 'edit_draft',
    description:
      '下書きの本文をそのまま差し替える。運用者が本文を自分で書いた（決めた）ときに使う。時刻（HH:MM）で下書きを指定する。飾りの記号は自動で取り除く。',
    input_schema: {
      type: 'object',
      properties: {
        account: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD。省略すると明日' },
        time: { type: 'string', description: '下書きの予定時刻 HH:MM（日本時間）' },
        body: { type: 'string', description: '新しい本文（全文）' },
        keyword: { type: 'string', description: '合言葉。空文字なら「求めない」' },
      },
      required: ['account', 'time', 'body'],
    },
  },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RANGE_RE = /^\d{1,2}(-\d{1,2})?$/;

/**
 * 道具を実行する。戻り値は Claude に返す文字列（人が読める日本語）。
 * @param {string} name
 * @param {object} input
 * @param {object} ctx { user, accounts }
 */
export async function runTool(name, input, ctx) {
  const { user, accounts } = ctx;
  // 運用に関わることは誰でも変えられる。変えられないのはツールの仕様（コード）だけ

  if (name === 'list_drafts') {
    const acc = await findAccount(input.account, accounts);
    const date = DATE_RE.test(input.date ?? '') ? input.date : tomorrowJst();
    const snap = await getDb().collection(COLLECTIONS.posts).where('accountId', '==', acc.id).get();
    const rows = snap.docs
      .map((d) => d.data())
      .filter((p) => ['pending', 'approved'].includes(p.status) && (p.plannedDate ?? jstOf(p.scheduledAt).toISOString().slice(0, 10)) === date)
      .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)));
    if (!rows.length) return `${date} の @${acc.name} に下書きはありません。`;
    return rows
      .map((p) => `- ${jstOf(p.scheduledAt).toISOString().slice(11, 16)} [${POST_TYPES[p.type]?.label ?? p.type}] ${p.status === 'approved' ? '承認済み' : '承認待ち'} 合言葉:${p.keyword ?? 'なし'} ｜ ${String(p.body).split('\n')[0].slice(0, 30)}`)
      .join('\n');
  }

  if (name === 'set_day_directive') {
    const acc = await findAccount(input.account, accounts);
    const date = DATE_RE.test(input.date ?? '') ? input.date : null;
    const r = await applyDirective({ account: acc, action: input.action, date, setBy: user.name, regenerate: input.regenerate !== false, types: Array.isArray(input.types) ? input.types.filter((t) => POST_TYPES[t]) : null, instruction: input.instruction ?? null });
    return `@${acc.name} の ${r.date} を「${r.action}」にしました。${r.count === null ? r.note : `${r.count}本作成${r.rejected ? `、前の${r.rejected}本は却下` : ''}。${r.note ?? ''}`}`;
  }

  if (name === 'generate_posts') {
    const acc = await findAccount(input.account, accounts);
    const date = DATE_RE.test(input.date ?? '') ? input.date : tomorrowJst();
    const types = Array.isArray(input.types) ? input.types : [];
    const slots = Array.isArray(input.slots) ? input.slots : [];
    if (!types.length || types.length !== slots.length) throw new Error('types と slots は同じ数で指定してください。');
    for (const t of types) if (!POST_TYPES[t]) throw new Error(`未知の型: ${t}`);
    for (const s of slots) if (!/^\d{1,2}:\d{2}$/.test(s)) throw new Error(`時刻の形式が違います: ${s}`);
    let rejected = 0;
    if (input.replace === true) rejected = await rejectDraftsFor(acc.id, date, `相談での指示（${user.name}）で作り直し`);
    const r = await generateForAccount(acc, { date, types, slots, instruction: input.instruction ?? '' });
    const made = r.posts.map((p) => `${jstOf(p.scheduledAt).toISOString().slice(11, 16)} [${POST_TYPES[p.type]?.label ?? p.type}] ${String(p.body).split('\n')[0].slice(0, 30)}`);
    return `@${acc.name} の ${date} に ${r.posts.length}本を作りました（承認待ち）${rejected ? `。前の${rejected}本は却下` : ''}。\n${made.join('\n')}`;
  }

  if (name === 'set_impression_lines') {
    const has = ['bad', 'good', 'buzz'].some((k) => Number.isFinite(input[k]));
    const lines = has ? await saveLines(input, user.name) : await loadLines();
    return `表示数の線: ${lines.bad}未満=悪い / ${lines.good}以上=良い / ${lines.buzz}以上=バズ（3時間後の表示。全名義共通）${has ? ' に変えました。' : ''}`;
  }

  if (name === 'delete_post') {
    const acc = await findAccount(input.account, accounts);
    const date = DATE_RE.test(input.date ?? '') ? input.date : jstOf(new Date().toISOString()).toISOString().slice(0, 10);
    if (!/^\d{1,2}:\d{2}$/.test(input.time ?? '')) throw new Error('time は HH:MM で指定してください。');
    const snap = await getDb().collection(COLLECTIONS.posts).where('accountId', '==', acc.id).get();
    const hit = snap.docs.find((d) => {
      const p = d.data();
      if (p.status !== 'posted') return false;
      const j = jstOf(p.scheduledAt);
      return (p.plannedDate ?? j.toISOString().slice(0, 10)) === date && j.toISOString().slice(11, 16) === input.time.padStart(5, '0');
    });
    if (!hit) throw new Error(`${date} ${input.time} の投稿済みが見つかりません。`);
    const r = await deletePostedPost({ postId: hit.id, by: `相談（${user.name}）` });
    return `@${r.accountName} の ${date} ${input.time}「${r.head}」を Threads から消しました。`;
  }

  if (name === 'edit_draft') {
    const acc = await findAccount(input.account, accounts);
    const date = DATE_RE.test(input.date ?? '') ? input.date : tomorrowJst();
    if (!/^\d{1,2}:\d{2}$/.test(input.time ?? '')) throw new Error('time は HH:MM で指定してください。');
    const body = normalizeNumbers(stripDecorations(String(input.body ?? ''))).trim();
    if (!body) throw new Error('本文が空です。');
    const snap = await getDb().collection(COLLECTIONS.posts).where('accountId', '==', acc.id).get();
    const hit = snap.docs.find((d) => {
      const p = d.data();
      if (!['pending', 'approved'].includes(p.status)) return false;
      const j = jstOf(p.scheduledAt);
      return (p.plannedDate ?? j.toISOString().slice(0, 10)) === date && j.toISOString().slice(11, 16) === input.time.padStart(5, '0');
    });
    if (!hit) throw new Error(`${date} ${input.time} の下書きが見つかりません。list_drafts で時刻を確かめてください。`);
    const upd = { body, editedBy: `相談（${user.name}）`, updatedAt: new Date().toISOString() };
    if (input.keyword !== undefined) upd.keyword = stripDecorations(String(input.keyword)).trim() || null;
    await hit.ref.set(upd, { merge: true });
    return `@${acc.name} の ${date} ${input.time} の本文を差し替えました（${[...body].length}文字${input.keyword !== undefined ? `、合言葉: ${upd.keyword ?? 'なし'}` : ''}）。承認の状態は変えていません。`;
  }

  if (name === 'update_persona') {
    const acc = await findAccount(input.account, accounts);
    if (!acc.persona) throw new Error(`@${acc.name} にキャラ設定がありません。`);
    const upd = {};
    const changed = [];
    const range = (v, label) => {
      if (v === undefined) return;
      const t = String(v).trim();
      if (t === '' && label === 'askPerDay') { upd.askPerDay = null; changed.push('合言葉を求める本数: 毎回'); return; }
      if (!RANGE_RE.test(t)) throw new Error(`${label} は "3" や "3-4" の形で指定してください。`);
      upd[label] = t;
      changed.push(`${label}: ${t}`);
    };
    range(input.postsPerDay, 'postsPerDay');
    range(input.askPerDay, 'askPerDay');
    range(input.minGap, 'minGap');
    if (input.bands !== undefined) {
      parseBands(input.bands); // 書式が違えば例外
      upd.bands = input.bands;
      changed.push(`帯: ${input.bands.join(' / ')}`);
    }
    for (const k of ['buzzTrial', 'slumpBuzz', 'useDayPatterns', 'reuseWinners', 'autoDeleteFlops', 'noSuperBuzz', 'hasAudience']) {
      if (typeof input[k] === 'boolean') { upd[k] = input[k]; changed.push(`${k}: ${input[k] ? 'ON' : 'OFF'}`); }
    }
    if (input.buzzTone) { upd.buzzTone = input.buzzTone === 'light' ? 'light' : 'normal'; changed.push(`バズ型の強さ: ${upd.buzzTone}`); }
    if (input.slumpPosts) { upd.slumpPosts = Math.max(1, Math.min(3, Number(input.slumpPosts) || 1)); changed.push(`落ち込み中の本数: ${upd.slumpPosts}`); }
    if (input.superBuzzOnlyAfterDays !== undefined) { upd.superBuzzOnlyAfterDays = Math.max(0, Math.min(7, Number(input.superBuzzOnlyAfterDays) || 0)); changed.push(`超バズだけにするまでの日数: ${upd.superBuzzOnlyAfterDays}`); }
    if (input.superBuzzAfterDays !== undefined) { upd.superBuzzAfterDays = Math.max(0, Math.min(7, Number(input.superBuzzAfterDays) || 0)); changed.push(`超バズを入れるまでの日数: ${upd.superBuzzAfterDays}`); }
    if (input.slumpType) { upd.slumpType = input.slumpType === 'reading_open' ? 'reading_open' : 'buzz_engagement'; changed.push(`落ち込み中の型: ${upd.slumpType}`); }
    for (const k of ['winnersFrom', 'winnersTo']) {
      if (input[k] !== undefined) {
        if (input[k] && !DATE_RE.test(input[k])) throw new Error(`${k} は YYYY-MM-DD で指定してください。`);
        upd[k] = input[k] || null;
        changed.push(`${k}: ${input[k] || 'なし'}`);
      }
    }
    if (Array.isArray(input.dayMix)) {
      const mix = input.dayMix.filter((t) => POST_TYPES[t]);
      upd.dayMix = mix;
      upd.postsPerDay = mix.length ? String(mix.length) : acc.persona.postsPerDay ?? '3-4';
      changed.push(`1日の構成: ${mix.length ? mix.map((t) => POST_TYPES[t].label).join('＋') : '解除'}`);
    }
    if (input.model) {
      if (!MODELS[input.model]) throw new Error('モデルの指定が不正です。');
      upd.model = input.model;
      changed.push(`モデル: ${MODELS[input.model].label}`);
    }
    if (input.styleRulesAdd?.length || input.styleRulesRemove?.length) {
      let rules = [...(acc.persona.styleRules ?? [])];
      for (const r of input.styleRulesRemove ?? []) rules = rules.filter((x) => !x.includes(r));
      for (const r of input.styleRulesAdd ?? []) if (r && !rules.includes(r)) rules.push(r);
      upd.styleRules = rules;
      changed.push(`書き方のきまり: ${rules.length}行`);
    }
    if (!changed.length) return '変える項目がありませんでした。';
    upd.updatedAt = new Date().toISOString();
    upd.updatedBy = `相談（${user.name}）`;
    await getDb().collection(COLLECTIONS.personas).doc(acc.personaId).set(upd, { merge: true });
    try {
      // 画面のキャッシュを捨てる。Next の外（scripts/ops.mjs）では読み込めないので飛ばす（画面は45秒で自然に更新される）
      const { invalidate, TAGS } = await import('./repo.mjs');
      invalidate(TAGS.personas, TAGS.accounts);
    } catch {
      // 上記のとおり
    }
    return `@${acc.name} のキャラ設定を変えました: ${changed.join('、')}。次の生成（15:30）から効きます。今日ぶんをすぐ作り直すなら set_day_directive か generate_posts を使ってください。`;
  }

  throw new Error(`知らない道具です: ${name}`);
}

/** 渡す道具。運用は誰でも扱える。 */
export function toolsFor() {
  return TOOLS;
}
