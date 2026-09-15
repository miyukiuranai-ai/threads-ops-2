// 生成の共通ルール（SYSTEM）とプロンプト（user）の組み立て。
// 文言は仕様書 5 章と 14-2 のとおり。
import { typeGuideText, POST_TYPES, TIERS } from './post-types.mjs';
import { slotLabel } from './time.mjs';

export const GENERATION_SYSTEM = `あなたは Threads の複数名義（占い師）の投稿文を書く担当です。目的は LINE の友だち追加です。反響（表示・いいね）ではなく登録で判断します。

最大の軸「この人だからこそ頼りたい」。不安を言葉にしてから肯定で受け止める。面白がらせるより信用させる。コメントは求めるが求めすぎない。いいねだけを求めない（バズ型を除く）。

参考投稿は「ほぼそのまま」使ってよい。変えるのは土地の名前、名義の名前、合言葉や絵文字、括弧の種類、一語の言い換え程度（例: 「兵庫県にいます」→「大阪府に来ております」）。参考に無い要素（名乗り、経歴、比喩、由来話、飾りの情景）を足さない。長さも参考と同じ程度。凝りすぎると属人の意味が消える。一人称と語尾だけ Persona に合わせる。直近の自投稿と同じ土地・合言葉・書き出しを続けない。過去投稿と同じ書き出し、同じ比喩を繰り返さない。

合言葉は「置く人が迷わず打てるもの」: 絵文字1つ、または誰でも読める2文字以内の身近な語（縁、恋、水、光、朝、月、花、鈴、名義の土地名）。難しい地名・固有名詞・読めない漢字・3文字以上は禁止。土地移動型・寺社訪問型の合図は県名や市名でよい。「好きな絵文字をひとつ」「好きな動物」も可。直近12本の合言葉は避ける（絵文字と土地名は数日空けば可）。

暦は「対象日の暦」に書かれた名前だけ。無い名前や縁起を作らない。

誇大な断定（必ず儲かる、病気が治る）や医療・投資の助言はしない。

本文 500 文字以内。1行に1〜2文。改行は意味の切れ目だけ。空行は段落の切れ目に1つ、本文全体で2つまで。骨格を写すときは骨格の行数と空行を守る。

数は 0〜9 の数字（3時15分、27分後、15年、2〜3ヶ月先）。漢数字は「千年」「万年」「一粒万倍日」「お一人お一人」のような言い回しだけ。

ハッシュタグなし、URL なし。絵文字は行末に1つまで。

アスタリスク（* ＊）や ✴︎ ✳️ ❇️ で語を囲む強調は絶対禁止。太字の記法も禁止。【】「」で囲うのは可。

slotName は型が分かる短い英小文字スネークケース。

imageBrief は画像方針に従う（always/sometimes/rarely）。本文と矛盾しない、土地に実在しうる情景、構図と被写体を1〜2文。imageRequired は本文が画像そのものを指すときだけ true。迷ったら false。

超バズ特化型（image_buzz）は画像ストックの在庫から imageKind（pair/single）と imageGenre を必ず選び、漢字なら imageNote にその字を書く。バズ特化型・霊視開始型は「添えてもよい画像」があれば imageGenre を選んでよい（無ければ空）。土地移動型・寺社訪問型は imagePlace に「都道府県 寺社や名所 2〜3個」を書く。

出力は JSON のみ: {"posts":[{"slot","type","slotName","body","keyword","imageBrief","imageRequired","imageKind","imageGenre","imageNote","imagePlace","intent"}]}。説明文や前置きは書かない。`;

/** 骨格を使い回す名義（reuseWinners）で差し替える 3 行 */
export const REUSE_WINNERS_RULES = `骨格を使い回す名義です。次の決まりを最優先にしてください:
- 骨格の行数・順番・言い回しをそのまま写す。変えてよいのは時刻・日付・合図・季節の語だけ。時刻は枠に合わせる。
- 長さは骨格に合わせ、1日1本は短い骨格（6行以内）。
- 長い名乗り型は1日1本まで。`;

function section(title, body) {
  if (!body) return '';
  return `## ${title}\n${body}\n`;
}

/**
 * user プロンプトの組み立て。
 * ctx: { persona, date, weekdayLabel, slots:[{slot,type,role,note}], refs:{type:[{text,usage}]},
 *        noAskRefs:[], winners:[], recent:[], askCount, calendar, dayPattern, testimonial,
 *        directive, usedKeywords:[], learnings:{keep:[],stop:[]}, stock:{genres:[...]},
 *        optionalImages:[], lastResult, instruction }
 */
export function buildUserPrompt(ctx) {
  const { persona } = ctx;
  const parts = [];

  parts.push(`対象日: ${ctx.date}（${ctx.weekdayLabel || ''}）\n名義: @${ctx.accountName || ''}\n`);

  parts.push(section('Persona', [
    `名前: ${persona.name || ''}`,
    `人物設定:\n${persona.characterDoc || ''}`,
    persona.styleRules?.length ? `書き方のきまり:\n${persona.styleRules.map((r) => `- ${r}`).join('\n')}` : '',
    persona.ngWords?.length ? `言わないこと:\n${persona.ngWords.map((r) => `- ${r}`).join('\n')}` : '',
    persona.buzzTone === 'light' ? 'バズ型の強さ: light（煽りと数字の断定を使わない）' : '',
    `画像方針: ${persona.imagePolicy || 'rarely'}`,
  ].filter(Boolean).join('\n')));

  if (persona.reuseWinners) parts.push(section('骨格の使い回し', REUSE_WINNERS_RULES));

  if (ctx.instruction || ctx.directive) {
    parts.push(section('運用者からの指示（最優先）', [ctx.directive, ctx.instruction].filter(Boolean).join('\n')));
  }

  const typeKeys = [...new Set(ctx.slots.map((s) => s.type))];
  parts.push(section('使う型のガイド', typeGuideText(typeKeys)));

  parts.push(section('投稿枠（この枠と型で書く。本文に時刻を入れるなら枠の時刻に合わせる）', ctx.slots.map((s, i) => {
    const t = POST_TYPES[s.type];
    const bits = [`${i + 1}. slot=${s.slot}（${slotLabel(s.slot)}） type=${s.type}（${t?.name || s.type}）`];
    if (s.role) bits.push(`役割: ${s.role}`);
    if (s.note) bits.push(`注記: ${s.note}`);
    if (s.testimonial) bits.push(`いただいた声（この枠で使う。1件1回）: ${s.testimonial}`);
    return bits.join('　');
  }).join('\n')));

  if (ctx.dayPattern) parts.push(section('1日の構成', `${ctx.dayPattern.name}: ${ctx.dayPattern.roles.join(' → ')}`));

  const refLines = [];
  for (const k of typeKeys) {
    const list = ctx.refs?.[k] || [];
    for (const r of list) {
      refLines.push(`[${k}]${r.usage ? ` 使いどころ: ${r.usage}` : ''}\n${r.text}`);
    }
  }
  if (refLines.length) parts.push(section('参考投稿（ほぼそのまま使ってよい。変えるのは土地・名前・合言葉・一語程度）', refLines.join('\n---\n')));

  if (ctx.noAskRefs?.length) {
    parts.push(section('合言葉を指定しない締め方の手本', ctx.noAskRefs.map((r) => `${r.usage ? `使いどころ: ${r.usage}\n` : ''}${r.text}`).join('\n---\n')));
  }

  if (ctx.winners?.length) {
    parts.push(section('骨格（この名義の当たった投稿。行数・順番・言い回しをそのまま写す）', ctx.winners.map((w, i) => `骨格${i + 1}（コメント ${w.replies ?? 0}・表示 ${w.views ?? 0}）\n${w.text}`).join('\n---\n')));
  }

  if (ctx.recent?.length) {
    parts.push(section('直近の自投稿（同じ書き出し・土地・合言葉を続けない）', ctx.recent.map((p) => `[${p.date || ''} ${p.type || ''}]\n${p.body}`).join('\n---\n')));
  }

  parts.push(section('合言葉を求める本数', `${ctx.askCount} 本。残りの ${Math.max(0, ctx.slots.length - ctx.askCount)} 本は合言葉を指定しない（keyword は null）。合言葉を求めない投稿は「求めない締め方の手本」に倣う。`));

  if (ctx.usedKeywords?.length) parts.push(section('使用済みの合言葉（避ける）', ctx.usedKeywords.join('、')));

  if (ctx.calendar) parts.push(section('対象日の暦（ここに無い名前や縁起は作らない）', ctx.calendar));

  if (ctx.learnings && (ctx.learnings.keep?.length || ctx.learnings.stop?.length)) {
    parts.push(section('直近の結果から分かっていること', [
      ctx.learnings.keep?.length ? `続ける:\n${ctx.learnings.keep.map((s) => `- ${s}`).join('\n')}` : '',
      ctx.learnings.stop?.length ? `やめる:\n${ctx.learnings.stop.map((s) => `- ${s}`).join('\n')}` : '',
    ].filter(Boolean).join('\n')));
  }

  if (ctx.stock?.genres?.length) {
    parts.push(section('画像ストック（在庫のある系統と中身）', ctx.stock.genres.map((g) => `- ${g.genre}（${g.kind}）: ${g.notes.slice(0, 20).join('、') || '説明なし'}${g.count ? `（${g.count}枚）` : ''}`).join('\n')));
  } else if (typeKeys.includes('image_buzz')) {
    parts.push(section('画像ストック', '在庫がありません。超バズ特化型は imageKind と imageGenre を希望として書いてください（保留になります）。'));
  }

  if (ctx.optionalImages?.length) {
    parts.push(section('バズ特化型・霊視開始型に添えてもよい画像（場所の分からない1枚）', ctx.optionalImages.map((g) => `- ${g.genre}: ${g.notes.slice(0, 10).join('、')}`).join('\n')));
  }

  if (ctx.lastResult) {
    parts.push(section('直前の投稿の成績（3時間後の表示と判定）', ctx.lastResult));
  }

  parts.push(`出力は JSON のみ。posts は投稿枠の順に ${ctx.slots.length} 本。`);
  return parts.filter(Boolean).join('\n');
}

/** 返信コメントの分類 */
export const CLASSIFY_SYSTEM = `あなたは Threads のコメントを分類する担当です。各コメントを normal / negative / spam のどれかに分けます。
- negative: 否定、冷やかし、挑発、嘲笑、疑い（「嘘」「詐欺」「暇人」など）
- spam: 宣伝、勧誘、URL、無関係な定型文、業者らしいもの
- normal: それ以外（合言葉、相談、お礼、質問、感想）
出力は JSON のみ: {"results":[{"id":"...","verdict":"normal|negative|spam","reason":"短く"}]}`;

/** 日次レポート */
export function reportSystem(lines) {
  return `あなたは Threads の複数名義の運用を見ている分析担当です。日本語で、運用者が読んで判断できる短いレポートを書きます。

評価の物差し:
- いちばん見るのは表示数（インプレッション）。判定は全名義共通の絶対値で、フォロワー数・平均・名義の中央値とは比べない。
- 3時間後の表示: ${lines.bad}未満は「悪い」（配信に乗っていない）、${lines.bad}〜${lines.good}は「普通」、${lines.good}〜${lines.buzz}は「良い」、${lines.buzz}以上は「バズ」。
- 日ごとの推移は表示数の中央値で見る（平均は使わない）。
- 取れ高＝LINE 追加数 ÷ 表示 × 1万。登録率と表示数の相関は出さない。
- コメントが付いていいねも一定ある投稿を良しとする。いいねだけの投稿は評価しない。
- 集客（LINE 追加）が来ている名義には権威性があるので、超バズだけにはしない。
- 「落ちた→バズ→回復」は未検証と明記する。母数が少なければ「まだ分からない」と書く。
- 提案は問いの形にする（「1本に絞りますか」「バズを1本挟みますか」）。

出力は JSON のみ:
{"overall":"全体の所感（3〜6行）","alerts":[{"account":"名義名","level":"落ち込み|注意|好調","message":"指摘","proposal":"問いの形の提案"}],"accounts":[{"account":"名義名","keep":["続けること"],"stop":["やめること"],"note":"一言"}]}`;
}

/** 相談（chat） */
export function chatSystem({ policy, memory, report, personas, watchlist, calendar, lines }) {
  return `あなたは Threads 自動運用ツール「threads-ops（検証）」の相談相手です。運用者と日本語で話し、必要なら道具を使って実行します。実行した内容は会話に残ります。

方針（CLAUDE.md）:
${policy || '（未登録）'}

判断メモ:
${memory || '（未登録）'}

表示数の線: 悪い<${lines.bad} / 普通 / 良い>=${lines.good} / バズ>=${lines.buzz}

最新のレポート:
${report || '（まだありません）'}

名義の設定（要約）:
${personas || '（なし）'}

監視リスト:
${watchlist || '（なし）'}

今日の暦:
${calendar || '（名のある暦なし）'}

決まり:
- 答えは短く。数字は 0〜9 の数字。飾り記号は使わない。
- 道具で変更する前に、何をするかを一言添える。取り消せない操作（削除）は確認を求める。
- 分からないことは分からないと言う。`;
}

export function tierLabel(tier) { return TIERS[tier] || tier; }
