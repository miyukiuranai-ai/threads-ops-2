// 投稿案の生成パイプライン。CLI と Cron の両方から使う。
import { randomUUID } from 'node:crypto';
import { getDb, COLLECTIONS } from './firebase.mjs';
import { HISTORY_COLLECTION } from './scoring.mjs';
import { generatePosts, POST_TYPES, DAY_PATTERNS } from './generate.mjs';
import { applyJitter, buildDailySlots, buildBandedSlots, parseBands } from './schedule.mjs';
import { latestGuidance } from './report.mjs';
import { luckyDaysFor } from './lucky-days.mjs';
import { assessMomentum } from './slump.mjs';
import { assessByLines, recentVerdicts, loadLines, VERDICT_LABEL } from './impressions.mjs';
import { stripDecorations, normalizeNumbers } from './text-clean.mjs';
import { pickUnusedTestimonial, markTestimonialUsed } from './testimonials.mjs';
import { loadDirective, DIRECTIVE_ACTIONS, ALL_ACCOUNTS } from './directives.mjs';
import { stockSummary, textStockSummary, pickStock, pickPlaceStock, pickStockForRequired, markStockUsed, stockToMedia } from './stock.mjs';
import { loadAutoApprove, canAutoApprove } from './auto-approve.mjs';

/** その土地の画像を必ず添える型（本人 9/12: 大阪なら住吉大社、大阪天満宮、難波神社のように土地が分かる画像）。 */
const PLACE_IMAGE_TYPES = new Set(['travel_note', 'shrine_visit']);
/**
 * 本文や合図から画像の被写体を推し量る（本人 9/14「画像はある程度ランダムでいい。ただし⛩️を求めているなら鳥居、は大事」）。
 * 左が本文・合図に出る語、右がストックの系統に含まれていてほしい語。
 */
const SUBJECT_HINTS = [
  ['⛩️', '鳥居'], ['鳥居', '鳥居'], ['神社', '鳥居'], ['聖域', '鳥居'],
  ['🐉', '龍'], ['龍', '龍'], ['🐍', '蛇'], ['蛇', '蛇'],
  ['🌙', '月'], ['🌕', '月'], ['月', '月'],
  ['🌸', '花'], ['🪷', '花'], ['花', '花'], ['🍀', '開運'], ['☘️', '開運'], ['四つ葉', '開運'],
  ['富士', '富士'], ['🦌', '鹿'], ['鹿', '鹿'], ['🐅', '虎'], ['虎', '虎'], ['🔥', '炎'], ['🌅', '朝日'], ['朝日', '朝日'], ['☀️', '朝日'],
  ['キツネ', 'キツネ'], ['🦊', 'キツネ'], ['白鳥', '白鳥'], ['🦢', '白鳥'], ['水墨', '水墨画'], ['墨', '水墨画'],
];
export function hintedGenres(text, genres) {
  const t = String(text ?? '');
  const out = [];
  for (const [word, want] of SUBJECT_HINTS) {
    if (!t.includes(word)) continue;
    for (const g of genres) if (g.includes(want) && !out.includes(g)) out.push(g);
  }
  return out;
}

/** ストックの画像を「付けたり付けなかったり」で添える型。属人型には付けない（本人 9/14「バズ特化だけ」）。 */
const ALT_IMAGE_TYPES = new Set(['buzz_engagement', 'reading_open']);

/** 翌日の日付（日本時間）を "YYYY-MM-DD" で返す。 */
export function tomorrowJst() {
  const jstNow = new Date(Date.now() + 9 * 3600000);
  const jstTomorrow = new Date(jstNow.getTime() + 86400000);
  return jstTomorrow.toISOString().slice(0, 10);
}

/**
 * 「画像が必要」なのに画像が無い投稿へ、ストックから 1 件を付ける（threads-ops2 で追加）。
 * 付いたら保留を解いて承認待ちに戻す。付けられなければそのまま（保留か、23:30 の仕分けで却下）。
 * @returns {Promise<boolean>} 付けられたか
 */
export async function attachStockForRequired(record, { accountId, stockGenres = [] }) {
  try {
    const genres = stockGenres.map((g) => g.genre);
    const hintGenres = hintedGenres(`${record.keyword ?? ''} ${record.body ?? ''} ${record.imageBrief ?? ''}`, genres);
    const isPlace = PLACE_IMAGE_TYPES.has(record.type);
    const picked = await pickStockForRequired({
      accountId,
      genre: record.imageGenre,
      note: record.imageNote,
      hintGenres,
      placeText: `${record.imagePlace ?? ''} ${record.body ?? ''}`,
      preferPlace: isPlace,
    });
    if (!picked) return false;
    const { item, how } = picked;
    record.media = stockToMedia(item);
    record.stockId = item.id;
    record.imageKind = item.kind ?? record.imageKind ?? 'single';
    record.imageGenre = item.genre ?? record.imageGenre ?? null;
    const label = `${item.genre ?? ''}${item.note ? `・${item.note}` : ''}`;
    const note = isPlace && how !== '土地の合う画像'
      ? `土地の合う画像が無かったので、${how}を仮に付けました（${label}）。差し替えてよい`
      : `ストックから自動で付けました（${how}: ${label}）`;
    record.imageBrief = record.imageBrief ? `${record.imageBrief}。${note}` : note;
    if (record.status === 'held' && record.holdReason === '画像が未準備') {
      record.status = 'pending';
      record.holdReason = null;
    }
    return true;
  } catch {
    return false;
  }
}

/** 生成対象の名義を集める（稼働中かつ Persona 設定済み）。 */
export async function listGeneratableAccounts(accountName = null, { group = null } = {}) {
  const db = getDb();
  const snap = await db.collection(COLLECTIONS.accounts).get();
  let accounts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  if (accountName) {
    const needle = accountName.replace(/^@/, '').toLowerCase();
    accounts = accounts.filter((a) => (a.name ?? '').toLowerCase() === needle);
    if (!accounts.length) throw new Error(`名義 "${accountName}" が見つかりません。`);
    return accounts;
  }

  // 担当（グループ）で絞る。「keidai の名義だけ作る」のような使い方（threads-ops2 で追加）
  if (group) {
    const needle = String(group).trim().toLowerCase();
    accounts = accounts.filter((a) => String(a.group ?? 'main').toLowerCase() === needle);
    if (!accounts.length) throw new Error(`担当 "${group}" の名義がありません。`);
  }

  return accounts.filter((a) => (a.status ?? 'active') === 'active' && a.personaId);
}

/**
 * その日の投稿枠と型を決める。
 * Persona に postingSlots が書かれていればそれを使い（固定枠）、
 * 無ければ本数と時間帯の設定から日ごとに組み立てる。
 */
/** 型を時間帯に当てる順番。バズ型は早い枠（早朝が効く）、属人型は遅い枠（深夜が効く）。 */
const MIX_ORDER = { image_buzz: 0, buzz_engagement: 1, reading_open: 2, exclusion_hook: 3, shrine_visit: 4, travel_note: 5, personal_note: 6, attract_intro: 7 };
export function orderMix(mix) {
  return [...mix].sort((a, b) => (MIX_ORDER[a] ?? 9) - (MIX_ORDER[b] ?? 9));
}

/** 型の並びをその日ごとにランダムにする（本人 9/14「どの型をどの時間帯、もランダムに」）。 */
export function shuffleTypes(types) {
  const a = [...types];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function planDay(persona, { slots = null, types = null, limit = null, floor = null } = {}) {
  if (slots) {
    return { slots, types: types ?? persona.defaultTypes ?? slots.map(() => 'attract_intro') };
  }

  if (persona.postingSlots?.length) {
    const fixed = persona.postingSlots;
    return { slots: fixed, types: types ?? persona.defaultTypes ?? fixed.map(() => 'attract_intro') };
  }

  let [minPosts, maxPosts] = (persona.postsPerDay ?? '3-5')
    .split('-')
    .map((n) => Number(n.trim()));
  if (!Number.isFinite(maxPosts)) maxPosts = minPosts;
  // 構成の要望（例: バズ型＋属人型）があれば、型はその比率で繰り返す。本数は「1日の本数」（例 2-5）の中で日ごとに決める
  // （本人 9/14「全員 1日 2〜5本」。構成は本数を固定しない）
  const mix = Array.isArray(persona.dayMix) && persona.dayMix.length ? orderMix(persona.dayMix) : null;
  // 型をどの時間帯に置くかは日ごとにランダム（早朝がバズ向き、深夜が属人向き、という固定はしない）
  const typesFromMix = (n) => shuffleTypes(Array.from({ length: n }, (_, i) => mix[i % mix.length]));
  // 落ち込んでいる日は本数を絞る（増やす方向には使わない）
  if (limit != null) {
    maxPosts = Math.min(maxPosts, limit);
    minPosts = Math.min(minPosts, maxPosts);
  }
  // 最低の本数（超バズ・バズ特化・属人を全部入れる日は 3本以上にする）
  if (floor != null) {
    minPosts = Math.max(minPosts, floor);
    maxPosts = Math.max(maxPosts, minPosts);
  }
  const [windowStart, windowEnd] = (persona.activeWindow ?? '06:30-23:55').split('-');

  // minGap は "240" でも "240-300" でも書ける。範囲ならその日ごとに決める
  const gapParts = String(persona.minGap ?? 150)
    .split('-')
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isFinite(n));
  const minGapMinutes =
    gapParts.length > 1
      ? Math.round(gapParts[0] + Math.random() * (gapParts[1] - gapParts[0]))
      : gapParts[0];

  // 時間帯が指定されていれば、帯ごとに1本ずつ置く方式を使う
  if (persona.bands?.length) {
    const banded = buildBandedSlots({
      bands: parseBands(persona.bands),
      minPosts,
      maxPosts,
      minGapMinutes,
    });
    const fallback = persona.dayTypes?.length ? persona.dayTypes : ['exclusion_hook'];
    return {
      slots: banded.map((b) => b.slot),
      types: types ?? (mix ? typesFromMix(banded.length) : shuffleTypes(banded.map((b, i) => b.type ?? fallback[i % fallback.length]))),
    };
  }

  const built = buildDailySlots({
    windowStart,
    windowEnd,
    minPosts,
    maxPosts,
    minGapMinutes,
    nightAnchor: persona.nightAnchor ?? null,
  });

  // 深夜枠には集客用の型を、日中には日替わりの型を割り当てる
  const dayTypes = persona.dayTypes?.length ? persona.dayTypes : ['exclusion_hook'];
  const nightType = persona.nightType ?? 'attract_intro';
  const hasNight = Boolean(persona.nightAnchor);

  const mixTypes = mix ? typesFromMix(built.length) : null;
  const assigned = built.map((_, i) => {
    if (mixTypes) return mixTypes[i];
    const isLast = i === built.length - 1;
    if (hasNight && isLast) return nightType;
    return dayTypes[i % dayTypes.length];
  });

  return { slots: built, types: types ?? shuffleTypes(assigned) };
}

/**
 * 型ごとのお手本を日替わりで選ぶ。
 * 登録順に並べ、日付から決めた位置から3本ずつ取る（1日ごとに次の3本へ進み、端まで来たら先頭に戻る）。
 * 同じ日に同じ型を何本作っても同じ3本を見るので、ぶれない。
 */
export function rotateReferences(allRefs, types, dateStr, perType = 3) {
  const dayIndex = Math.floor(Date.parse(`${dateStr}T00:00:00Z`) / 86400000);
  const out = [];
  for (const type of [...new Set(types)]) {
    const pool = allRefs
      .filter((r) => r.category === type)
      .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) || String(a.text ?? '').localeCompare(String(b.text ?? '')));
    if (!pool.length) continue;
    const start = ((dayIndex * perType) % pool.length + pool.length) % pool.length;
    for (let i = 0; i < Math.min(perType, pool.length); i += 1) out.push(pool[(start + i) % pool.length]);
  }
  return out;
}

/**
 * 対象日の前日から数えて、「その日の投稿がどれも good の線に届かなかった」日が何日つづいているか。
 * 3時間後の表示があればそれを、無ければ翌朝の表示数を使う。投稿が無い日は数えない（そこで止める）。
 */
export function daysBelowGood(history, targetDate, goodLine = 1000, maxDays = 7) {
  let count = 0;
  for (let back = 1; back <= maxDays; back += 1) {
    const d = new Date(Date.parse(`${targetDate}T00:00:00Z`) - back * 86400000).toISOString().slice(0, 10);
    const rows = history.filter((h) => h.timestamp && jstDateOf(h.timestamp) === d);
    if (!rows.length) continue; // 休んだ日は数えない（飛ばす）
    const best = Math.max(...rows.map((h) => (h.snap3h?.views != null ? h.snap3h.views : h.metrics?.views ?? 0)));
    if (best >= goodLine) break;
    count += 1;
  }
  return count;
}

/** 日本時間の日付（YYYY-MM-DD）。 */
function jstDateOf(iso) {
  return new Date(new Date(iso).getTime() + 9 * 3600000).toISOString().slice(0, 10);
}

/**
 * その日に合言葉を求める本数を決める。
 * 名義の「合言葉を求める本数」が "2-3" なら、前日が3本だった日は2本、2本だった日は3本と交互にする。
 * 前日の記録が無ければ範囲内でランダム。設定が無ければ null（全部の投稿で求めてよい）。
 */
export function decideAskCount(persona, pastPosts, targetDate, slotCount) {
  const m = String(persona.askPerDay ?? '').trim().match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const min = Number(m[1]);
  const max = Number(m[2] ?? m[1]);

  // 前日の日付。日付だけの計算なので UTC のまま引く（時差を混ぜると前々日になる）
  const prev = new Date(Date.parse(`${targetDate}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const yesterday = pastPosts.filter(
    (p) => p.scheduledAt && (p.plannedDate ?? jstDateOf(p.scheduledAt)) === prev &&
      !['rejected', 'missed', 'failed'].includes(p.status)
  );
  const asked = yesterday.filter((p) => p.keyword).length;

  let count;
  if (!yesterday.length) count = min + Math.floor(Math.random() * (max - min + 1));
  else if (asked >= max) count = min;
  else if (asked <= min) count = max;
  else count = asked === min ? max : min;

  return Math.min(count, slotCount);
}

/**
 * 1日の構成を選ぶ。前の2日で使った構成は避け、暦の日は名のある暦がある日にだけ出す。
 */
export function pickDayPattern(pastPosts, targetDate, calendar, { hasTestimonial = false } = {}) {
  const recent = new Set();
  for (let back = 1; back <= 2; back += 1) {
    const d = new Date(Date.parse(`${targetDate}T00:00:00Z`) - back * 86400000).toISOString().slice(0, 10);
    for (const p of pastPosts) {
      if ((p.plannedDate ?? jstDateOf(p.scheduledAt)) === d && p.dayPattern && !['rejected'].includes(p.status)) recent.add(p.dayPattern);
    }
  }
  const usable = DAY_PATTERNS.filter(
    (pt) =>
      (!pt.needsCalendar || (calendar?.today?.strong?.length ?? 0) > 0) &&
      (!pt.needsTestimonial || hasTestimonial)
  );
  const fresh = usable.filter((pt) => !recent.has(pt.key));
  const pool = fresh.length ? fresh : usable;
  // 暦の日が使えるときは少し優先する（毎回ではない）
  const cal = pool.find((pt) => pt.needsCalendar);
  if (cal && Math.random() < 0.6) return cal;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** 1名義分の投稿案を生成して保存する。 */
export async function generateForAccount(account, { types, slots, date, dry = false, instruction = '' } = {}) {
  const db = getDb();

  const personaSnap = await db.collection(COLLECTIONS.personas).doc(account.personaId ?? '_').get();
  if (!personaSnap.exists) {
    throw new Error(`@${account.name} に Persona が設定されていません。`);
  }
  const persona = { id: personaSnap.id, ...personaSnap.data() };

  const [refSnap, histSnap, postsSnap] = await Promise.all([
    db.collection('references').get(),
    db.collection(HISTORY_COLLECTION).where('accountId', '==', account.id).get(),
    db.collection(COLLECTIONS.posts).where('accountId', '==', account.id).get(),
  ]);

  // 落ち込みの判定。落ち込んでいれば1本、4回に1回は休む。
  // ただし、レポートの提案に返事（その日の指示）があれば、そちらを優先する
  const targetForDirective = date ?? tomorrowJst();
  const directive = slots ? null : await loadDirective(account.id, targetForDirective);
  const sharedNote = slots ? null : await loadDirective(ALL_ACCOUNTS, targetForDirective);
  // 「指示メモ」は本数や型を変えない。文章の指示だけを生成に渡す
  const directiveDef = directive && directive.action !== 'note' ? DIRECTIVE_ACTIONS[directive.action] : null;
  const noteInstruction = [sharedNote?.instruction, directive?.instruction]
    .filter(Boolean)
    .map((t, i) => (i === 0 && sharedNote?.instruction ? `（全名義に共通）${t}` : t))
    .join('\n');
  // 固定の構成がある名義は、落ち込みの自動調整・バズ狙い1本・構成の型を当てない（返事の指示は効く）
  // その日の構成指定（返事や相談から）があれば最優先。無ければ名義の「いまの要望」（dayMix）
  const dayMixRequest = directive?.action === 'mix' && Array.isArray(directive.types) && directive.types.length ? directive.types : null;
  const hasMix = Boolean(dayMixRequest) || (Array.isArray(persona.dayMix) && persona.dayMix.length > 0);
  // 勢いは「3時間後の表示」を全名義共通の線で判定した並びで見る（本人 9/14: 平均・中央値・フォロワーは基準にしない）。
  // 3時間後の記録が3本たまるまでは従来の判定を使う
  const historyRows = histSnap.docs.map((d) => d.data());
  const momentum = assessByLines(historyRows, { fallback: assessMomentum(historyRows) });
  const inSlump = momentum.state === 'slump';
  const momentumNote =
    momentum.method === 'lines'
      ? `落ち込み中（直近3本の3時間後がすべて「悪い」: ${momentum.verdicts.map((v) => VERDICT_LABEL[v] ?? v).join('・')}）`
      : `落ち込み中（直近の表示 ${Math.round(momentum.recent)} / 基準 ${Math.round(momentum.baseline)}）`;
  const lines = await loadLines();
  const lastVerdicts = recentVerdicts(historyRows, 3);
  if (directiveDef?.limit === 0 || (!directiveDef && inSlump && !hasMix && !slots && Math.random() < 0.25)) {
    return {
      persona,
      posts: [],
      usage: null,
      date: targetForDirective,
      momentum,
      note: directiveDef ? `返事「${directiveDef.label}」により、今日は休む` : `${momentumNote}。今日は休む`,
    };
  }

  const slumpPosts = Math.max(1, Math.min(3, Number(persona.slumpPosts) || 1));
  const limit = dayMixRequest ? dayMixRequest.length : directiveDef ? directiveDef.limit : inSlump && !hasMix ? slumpPosts : null;
  // 「集客が来ている名義」か（本人 9/14）。直近30日に LINE の追加が入っている、または 1,000 以上の投稿がある、またはキャラ設定で hasAudience。
  // こういう名義には権威性があるので、落ちても超バズだけにはせず、超バズで様子を見つつ属人もバズ特化も必ず入れる
  const monthAgo = Date.now() - 30 * 86400000;
  const signupsSnap = await db.collection('signups').where('accountId', '==', account.id).get();
  const hasSignups = signupsSnap.docs.some((d) => {
    const s = d.data();
    return (s.count ?? 0) > 0 && Date.parse(`${s.date}T00:00:00Z`) >= monthAgo;
  });
  const reachedRecently = historyRows.some((h) => {
    const v = h.snap3h?.views != null ? Math.max(h.snap3h.views, h.metrics?.views ?? 0) : h.metrics?.views ?? 0;
    return h.timestamp && v >= lines.good && Date.parse(h.timestamp) >= monthAgo;
  });
  const hasAudience = persona.hasAudience === true || hasSignups || reachedRecently;
  // 2日ルール（1,000 に届かない日がつづいたら超バズを1本挟む）が今日当たるか。集客のある名義は 3本以上にして、属人もバズ特化も残す
  const superBuzzDays = Number.isFinite(persona.superBuzzAfterDays) ? persona.superBuzzAfterDays : 2;
  const superBuzzDue =
    !types && !dayMixRequest && persona.noSuperBuzz !== true && superBuzzDays !== 0 && daysBelowGood(historyRows, date ?? tomorrowJst(), lines.good) >= superBuzzDays;
  const floor = superBuzzDue && hasAudience ? 3 : null;

  const planned = planDay(dayMixRequest ? { ...persona, dayMix: dayMixRequest, postsPerDay: String(dayMixRequest.length) } : persona, { slots, types, limit, floor });
  const useTypes = planned.types;
  for (const t of useTypes) {
    if (!POST_TYPES[t]) throw new Error(`未知の型: ${t}`);
  }
  // ジッター（±3〜10分）は本文を書く前にかける。
  // あとからずらすと「21時46分なので言いますが」と予定21:39が食い違うため、
  // 本文に出す時刻と予定時刻を最初から同じにする（日付をまたぐ枠は 25:10 のように表す）
  const planDate = date ?? tomorrowJst();
  const scheduledAts = planned.slots.map((slot) => applyJitter(planDate, slot));
  const useSlots = scheduledAts.map((iso) => {
    const jst = new Date(Date.parse(iso) + 9 * 3600000);
    const day = jst.toISOString().slice(0, 10);
    const hh = jst.getUTCHours() + (day > planDate ? 24 : 0);
    return `${String(hh).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`;
  });
  // 落ち込み中は、絞った1本をバズ型にする（露出を取り戻すため。名義ごとに OFF にできる）。
  // 返事があるときは、返事の内容（1本バズ）だけがバズ型にする
  // 型を手で指定して作るとき（--types）は、落ち込みのブーストで上書きしない
  const buzzAll = types ? false : directiveDef ? directiveDef.buzz === true : inSlump && !hasMix && persona.slumpBuzz !== false;
  if (buzzAll) {
    // 落ち込み中のブーストの型。既定はバズ型、名義の設定で霊視開始型にもできる。
    // 2本以上出す名義は、早いほうの1本をバズ型、残りをブーストの型にする
    const boostType = POST_TYPES[persona.slumpType] ? persona.slumpType : 'buzz_engagement';
    useTypes.fill(boostType);
    if (useTypes.length >= 2) useTypes[0] = 'buzz_engagement';
  }
  // 2日つづけて 1,000 に届かなかった名義は、超バズ特化型を1本入れてみる（本人 9/14。1日では早すぎる。星蘭で試す）。
  // 型を手で指定したとき、返事で構成が決まっているとき、超バズを使わない名義には当てない
  let superBuzzNote = null;
  // まったく届いていない名義（3日つづけて、その日の最高が「悪い」の線 300 に届かない）は、雅と同じく超バズ特化型だけにする
  // （本人 9/14「鈴木の名義でも同じものがあればそれになる。星蘭や玲月でも同じ兆候が出ればそうなる」）
  // ただし集客が来ている名義（hasAudience）は超バズだけにしない。落ちても超バズ1本を挟む段（下の2日ルール）までで、属人もバズ特化も残す
  // （本人 9/14「玲月も星蘭も集客が来ている＝権威性がある。超バズだけは必ずNG」）
  if (!types && !dayMixRequest && persona.noSuperBuzz !== true && persona.superBuzzOnlyAfterDays !== 0 && !hasAudience) {
    const deadDays = Number.isFinite(persona.superBuzzOnlyAfterDays) ? persona.superBuzzOnlyAfterDays : 3;
    const belowBad = daysBelowGood(historyRows, date ?? tomorrowJst(), lines.bad);
    if (belowBad >= deadDays) {
      useTypes.fill('image_buzz');
      superBuzzNote = `${belowBad}日つづけて3時間後の表示が ${lines.bad} に届かなかったので、今日は超バズ特化型だけにした`;
    }
  }
  if (!superBuzzNote && superBuzzDue && !useTypes.includes('image_buzz')) {
    const below = daysBelowGood(historyRows, date ?? tomorrowJst(), lines.good);
    // 替える枠: バズ特化が2本以上あればその1本、無ければ属人が2本以上あればその1本、それも無ければ早いほうの枠。
    // 集客のある名義はバズ特化と属人を1本ずつは残す（3本以上にしてある）
    const count = (t) => useTypes.filter((x) => x === t).length;
    const personalTypes = ['attract_intro', 'personal_note', 'exclusion_hook', 'shrine_visit', 'travel_note'];
    let i = -1;
    if (count('buzz_engagement') >= 2 || (!hasAudience && count('buzz_engagement') >= 1)) i = useTypes.indexOf('buzz_engagement');
    else if (useTypes.filter((x) => personalTypes.includes(x)).length >= 2) i = useTypes.findIndex((x) => personalTypes.includes(x));
    else if (!hasAudience) i = 0;
    if (i >= 0) {
      useTypes[i] = 'image_buzz';
      superBuzzNote = `${below}日つづけて3時間後の表示が ${lines.good} に届かなかったので、${useSlots[i]} を超バズ特化型にした${hasAudience ? '（集客のある名義なので属人とバズ特化は残す）' : ''}`;
    }
  }
  // 試験: バズ狙いを1日1本入れる名義は、どれか1枠をバズ型にする（最後の枠は避ける）
  if (!buzzAll && !inSlump && !hasMix && !types && persona.buzzTrial === true && useSlots.length >= 2) {
    const i = Math.floor(Math.random() * (useSlots.length - 1));
    useTypes[i] = 'buzz_engagement';
  }

  // お手本には「使いどころ」の注記（朝方限定、など）があれば添える
  const withNote = (r) => (r.usage ? `${r.text}\n（使いどころ: ${r.usage}）` : r.text);
  const allRefs = refSnap.docs.map((d) => d.data());
  // お手本は型ごとに3本ずつ、日替わりで入れ替えて渡す（同じ6本ばかりにならないように。本人 9/13「参考を切り替えるとき」）
  const references = rotateReferences(allRefs, useTypes, date ?? tomorrowJst()).map(withNote);
  // 「求めない」と注記されたお手本は、型に関わらず、合言葉を指定しない枠の手本として渡す
  const noAskReferences = allRefs.filter((r) => /^求めない/.test(r.usage ?? '')).map(withNote);

  const history = histSnap.docs.map((d) => d.data());
  const recentPosts = history
    .sort((a, b) => String(b.timestamp ?? '').localeCompare(String(a.timestamp ?? '')))
    .slice(0, 8)
    .map((h) => h.text);
  // 「当たった」の物差しは表示数ではなく、コメント数（登録につながる代理指標）。
  // いいねだけ多い投稿は LINE に効かないので、コメント数を先に、いいねは同数のときだけ見る。
  // ただし「手本にする期間」が入っていれば、その期間の投稿を全部そのまま使う。
  // 良かったかどうかは本人が LINE の登録で判断しているので、反響の数では選ばない。
  const jstDate = (iso) => new Date(new Date(iso).getTime() + 9 * 3600000).toISOString().slice(0, 10);
  const inPeriod = (h) => {
    if (!persona.winnersFrom || !h.timestamp) return false;
    const d = jstDate(h.timestamp);
    return d >= persona.winnersFrom && (!persona.winnersTo || d <= persona.winnersTo);
  };
  // 期間が長いときは、期間全体から均等に間引いて渡す（新しいものだけに偏らせない）
  const spread = (list, n) => {
    if (list.length <= n) return list;
    return Array.from({ length: n }, (_, i) => list[Math.round((i * (list.length - 1)) / (n - 1))]);
  };
  const winningPosts = persona.winnersFrom
    ? spread(
        history
          .filter(inPeriod)
          .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))),
        24
      ).map((h) => h.text)
    : history
        .filter((h) => (h.metrics?.views ?? 0) > 0 && (h.metrics?.replies ?? 0) > 0)
        .sort(
          (a, b) =>
            (b.metrics?.replies ?? 0) - (a.metrics?.replies ?? 0) ||
            (b.metrics?.likes ?? 0) - (a.metrics?.likes ?? 0)
        )
        .slice(0, 6)
        .map((h) => h.text);

  const usedKeywords = [
    ...new Set(
      postsSnap.docs
        .map((d) => d.data())
        .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
        .slice(0, 12) // 合言葉は絵文字や短い語に絞るので、避けるのは直近12本ぶんだけ
        .map((p) => p.keyword)
        .filter(Boolean)
    ),
  ];

  // 昨日までのレポートで「続ける」「やめる」と出たことを渡す。
  // 分析が投稿に効かないと意味がないので、ここで閉じる
  let guidance = { keep: [], stop: [] };
  try {
    guidance = await latestGuidance(account.name);
  } catch {
    // レポートが無くても生成は止めない
  }

  const askCount = decideAskCount(persona, postsSnap.docs.map((d) => d.data()), date ?? tomorrowJst(), useSlots.length);
  // 画像ストックの在庫（バズ型の枠があり、画像を使う名義のときだけ渡す）
  let stockGenres = [];
  if (useTypes.includes('image_buzz')) {
    try {
      stockGenres = await stockSummary(account.id);
    } catch {
      stockGenres = [];
    }
  }
  // 文章の型（バズ特化・属人）に添えてもよい画像。場所が分かるものは除く。共通＋名義専用（本人 9/12。かなり絞る）
  let textStock = [];
  if (useTypes.some((t) => ALT_IMAGE_TYPES.has(t))) {
    try {
      textStock = await textStockSummary(account.id);
    } catch {
      // 在庫が読めなくても生成は止めない（画像なしで進む）
    }
  }
  // 対象日の暦（一粒万倍日、寅の日など）。日付をまたぐ深夜枠のために翌日ぶんも渡す
  const targetDay = date ?? tomorrowJst();
  const nextDay = new Date(Date.parse(`${targetDay}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const calendar = { today: luckyDaysFor(targetDay), tomorrow: luckyDaysFor(nextDay) };
  // いただいた声。未使用があれば候補にし、「声の日」か、構成の型を使わない名義では4日に1回ほど混ぜる
  const voice = inSlump ? null : await pickUnusedTestimonial(account.id);

  // 1日の構成の型。当たっている名義は本来したい投稿でよいので、OFF にできる
  // 型を手で指定して作るとき（--types）は、構成の型も暦も当てない。指定した型そのもので書く
  const dayPattern =
    types || hasMix || persona.useDayPatterns === false
      ? null
      : pickDayPattern(postsSnap.docs.map((d) => d.data()), targetDay, calendar, { hasTestimonial: Boolean(voice) });
  let testimonial = null;
  if (voice && useSlots.length >= 2) {
    const useVoice = dayPattern ? dayPattern.key === 'voice' : Math.random() < 0.25;
    if (useVoice) {
      // バズ型の枠は避け、2本目を優先する
      const candidates = useSlots.map((_, i) => i).filter((i) => useTypes[i] !== 'buzz_engagement');
      const slotIndex = candidates.includes(1) ? 1 : candidates[0] ?? 0;
      testimonial = { id: voice.id, text: voice.text, slotIndex };
    }
  }

  const { posts, usage } = await generatePosts({
    persona,
    types: useTypes,
    slots: useSlots,
    askCount,
    // 暦は「暦の日」の構成を選んだときだけ渡す（渡すと他の型にも混ざるため）
    calendar: dayPattern?.needsCalendar ? calendar : null,
    noAskReferences,
    dayPattern,
    testimonial: testimonial ? { text: testimonial.text, slotIndex: testimonial.slotIndex } : null,
    buzzTone: persona.buzzTone === 'light' ? 'light' : 'normal',
    instruction: [noteInstruction, String(instruction ?? '').trim()].filter(Boolean).join('\n'),
    stockGenres,
    textStock,
    lastVerdicts,
    lines,
    references: references.length ? references : allRefs.map(withNote),
    recentPosts,
    winningPosts,
    usedKeywords,
    guidance,
    model: persona.model ?? undefined,
    reuseWinners: persona.reuseWinners === true,
  });
  if (askCount != null) {
    // 求めない投稿に合言葉が残っていたら落とす（指示より本数が多いとき）
    let left = askCount;
    for (const post of posts) {
      if (!post.keyword) continue;
      if (left > 0) left -= 1;
      else post.keyword = '';
    }
  }

  const baseDate = date ?? tomorrowJst();
  // 自動承認（設定 → 投稿の承認）。dry のときは保存しないので読まない
  const autoApprove = dry ? false : await loadAutoApprove();
  const saved = [];
  // 文章の型（バズ特化・属人）の画像は「使ったり使わなかったり」（本人 9/14）。直前の投稿に画像が付いていたら次は付けない、を繰り返す。
  // 起点は、この名義でいちばん新しい投稿（作成済み・投稿済み）に画像が付いていたかどうか
  let lastHadImage = (() => {
    const recent = postsSnap.docs
      .map((d) => d.data())
      .filter((p) => ['pending', 'approved', 'posted'].includes(p.status) && p.scheduledAt)
      .sort((a, b) => String(b.scheduledAt).localeCompare(String(a.scheduledAt)))[0];
    return Boolean(recent && (recent.media?.length || recent.imageUrls?.length));
  })();

  // 枠は Persona の設定を正とする。生成AIが返した slot は採用しない
  // （同じ枠を2回返し、別の枠が空くことがあるため）。枠の数を超えた分は捨てる。
  for (const [i, post] of posts.slice(0, useSlots.length).entries()) {
    const slot = useSlots[i];
    const scheduledAt = scheduledAts[i];
    const record = {
      accountId: account.id,
      accountName: account.name,
      personaId: persona.id,
      body: normalizeNumbers(stripDecorations(post.body)),
      type: useTypes[i] ?? useTypes[0],
      slot,
      slotName: post.slotName || null,
      keyword: stripDecorations(post.keyword) || null,
      imageBrief: post.imageBrief || null,
      imageRequired: post.imageRequired === true,
      imageKind: post.imageKind === 'pair' || post.imageKind === 'single' ? post.imageKind : null,
      imageGenre: post.imageGenre ? String(post.imageGenre) : null,
      imageNote: post.imageNote ? String(post.imageNote) : null, // 系統の中の1つ（漢字なら字）。本文をこれに合わせて書いている
      imagePlace: post.imagePlace ? String(post.imagePlace) : null, // 土地移動型・寺社訪問型の土地（都道府県 寺社や名所）
      imageUrls: [],
      intent: post.intent ?? null,
      status: 'pending',
      scheduledAt,
      plannedDate: baseDate, // どの日のぶんとして作ったか（深夜枠は翌日の時刻になるため、日付では判定しない）
      dayPattern: dayPattern?.key ?? null,
      testimonialId: testimonial && testimonial.slotIndex === i ? testimonial.id : null,
      postedThreadId: null,
      createdAt: new Date().toISOString(),
    };

    // 土地移動型・寺社訪問型は、その土地の画像を人に頼む（本人 9/12「大阪に来ています、なら大阪の画像を入れてくださいと指示してほしい」）。
    // 自動では付けず、「◯◯の画像を入れてください」と書いて保留にする。画像を付けると承認待ちに戻る
    if (PLACE_IMAGE_TYPES.has(record.type)) {
      record.imageRequired = true;
      record.imageGenre = null;
      record.imageKind = null;
      const place = String(record.imagePlace || '').trim();
      const [pref, ...spots] = place.split(/[\s、,，]+/).filter(Boolean);
      const prefName = (pref || '').replace(/[都道府県]$/, '') || 'この土地';
      const spotText = spots.length ? `${spots.join('、')}など、` : '';
      record.imageBrief = `${prefName}の画像を入れてください（${spotText}${prefName}と分かる寺社や名所）`;
      try {
        // ストックに土地の名前が合う画像があれば、探す手間が省けるように添えて知らせる（自動では付けない）
        const item = await pickPlaceStock({ placeText: `${place} ${record.body}`, accountId: account.id });
        if (item) record.imageBrief += `。画像ストックに「${item.genre}${item.note ? `・${item.note}` : ''}」があります`;
      } catch {
        // 案内が付かなくても保留にはする
      }
      record.status = 'held';
      record.holdReason = '画像が未準備'; // 画像を付けると承認待ちに戻る（media.js と同じ文言）
    } else if (ALT_IMAGE_TYPES.has(record.type) && record.imageGenre && !lastHadImage) {
      // バズ特化型だけ、画像は「使ったり使わなかったり」。直前に付けていなければ、系統が合う「場所が分からない1枚」を付ける。属人型には付けない
      try {
        const item = await pickStock({ kind: 'single', genre: record.imageGenre, accountId: account.id, forText: true });
        if (item) {
          record.media = stockToMedia(item);
          record.stockId = item.id;
          record.imageKind = 'single';
        }
      } catch {
        // 画像が付かなくても本文はそのまま使う
      }
      if (!record.media) {
        record.imageGenre = null;
        record.imageKind = null;
      }
    } else if (record.type !== 'image_buzz') {
      record.imageGenre = null;
      record.imageKind = null;
    }
    lastHadImage = Boolean(record.media?.length); // 超バズ特化型は必ず画像つきなので、その次の文章の型は画像なしになる

    // 画像が主役の型なら、ストックから自動で添える（その名義でいちばん使っていないもの）
    if (record.type === 'image_buzz') {
      // 画像バズ型は必ず画像つき。種類が出ていなければ2枚（くっつけ）を既定にする
      if (!record.imageKind) record.imageKind = 'pair';
      try {
        // 選び方（本人 9/14「ある程度ランダムでいい。合図が⛩️なら鳥居、は大事」）:
        // 1) AI が選んだ系統（漢字なら字も）に合う在庫 → 2) 本文や合図に出る被写体（⛩️→鳥居、🐉→龍…）に合う系統 → 3) 種類が合う中からいちばん使っていないもの
        let item = await pickStock({ kind: record.imageKind, genre: record.imageGenre, note: record.imageNote, accountId: account.id, strictGenre: true });
        if (!item) {
          const genres = stockGenres.map((g) => g.genre);
          for (const g of hintedGenres(`${record.keyword ?? ''} ${record.body}`, genres)) {
            item = await pickStock({ kind: record.imageKind, genre: g, accountId: account.id, strictGenre: true });
            if (item) break;
          }
        }
        // 被写体の指定が無い投稿は縁起物（系統「開運」「縁起」）を優先する（本人 9/14「特に指定の無いツイートではこういうのを使ってほしい」）
        if (!item) {
          for (const g of stockGenres.map((x) => x.genre).filter((g) => /開運|縁起/.test(g))) {
            item = await pickStock({ kind: record.imageKind, genre: g, accountId: account.id, strictGenre: true });
            if (item) break;
          }
        }
        if (!item) item = await pickStock({ kind: record.imageKind, accountId: account.id });
        if (!item) item = await pickStock({ kind: record.imageKind === 'pair' ? 'single' : 'pair', accountId: account.id });
        if (item) {
          record.imageGenre = item.genre ?? record.imageGenre;
          record.imageKind = item.kind ?? record.imageKind;
        }
        if (item) {
          record.media = stockToMedia(item);
          record.stockId = item.id;
          record.imageRequired = true;
        } else {
          record.status = 'held';
          record.holdReason = '画像が未準備'; // 画像を付けると承認待ちに戻る（media.js と同じ文言）
        }
      } catch {
        record.status = 'held';
        record.holdReason = '画像が未準備';
      }
    }

    // 画像が必要と判定されたのに付いていなければ、型や名義を問わずストックから付ける（本人 9/17）。
    // 土地移動型・寺社訪問型も、土地の合う画像が無ければ場所の分からない 1 枚を仮に付けて承認待ちに戻す（差し替えは画面から）
    if (record.imageRequired && !record.media?.length) {
      await attachStockForRequired(record, { accountId: account.id, stockGenres });
    }
    lastHadImage = Boolean(record.media?.length);

    // 自動承認が ON なら、承認待ちを飛ばして承認済みで保存する（本人 9/19）。
    // 画像が要るのに素材が無いものと、「自動仕分けから外す」名義はこれまで通り人が見る
    if (autoApprove && canAutoApprove(record, account)) {
      record.status = 'approved';
      record.autoReviewed = true;
      record.autoReviewReason = '自動承認が ON のため、生成と同時に承認しました';
      record.reviewedAt = new Date().toISOString();
    }

    if (!dry) {
      const id = randomUUID();
      await db.collection(COLLECTIONS.posts).doc(id).set(record);
      if (record.testimonialId) await markTestimonialUsed(record.testimonialId, id);
      if (record.stockId) await markStockUsed(record.stockId, account.id, id);
      saved.push({ id, ...record });
    } else {
      saved.push(record);
    }
  }

  return {
    persona,
    posts: saved,
    usage,
    date: baseDate,
    momentum,
    superBuzzNote,
    note: dayMixRequest
      ? `その日の構成指定（${dayMixRequest.map((t) => POST_TYPES[t]?.label ?? t).join('＋')}）を適用${inSlump ? `（${momentumNote}）` : ''}`
      : directiveDef
      ? `返事「${directiveDef.label}」を適用${inSlump ? `（${momentumNote}）` : ''}`
      : inSlump && hasMix
        ? `${momentumNote}。固定の構成なので本数はそのまま`
        : inSlump
        ? `${momentumNote}。${slumpPosts}本に絞った${persona.slumpBuzz !== false ? `（${slumpPosts >= 2 ? 'バズ型＋' : ''}${POST_TYPES[persona.slumpType]?.label ?? 'バズ型'}）` : ''}`
        : null,
  };
}

/** 全名義分をまとめて生成する。1名義の失敗が他を止めない。 */
export async function generateDaily({ date, accountName = null, group = null } = {}) {
  const db = getDb();
  const startedAt = new Date().toISOString();
  const accounts = await listGeneratableAccounts(accountName, { group });
  const results = [];

  // 名義ごとに順番に回すと、9名義で4分を超えて Vercel の上限（5分）に迫る。
  // 互いに依存しないので同時に走らせる。1名義の失敗は他を止めない
  // その日ぶんが既にある名義は作らない。Cron の遅れや手動実行と重なって
  // 二重に作られるのを防ぐ（承認待ち・承認済みがあれば「作成済み」とみなす）
  const targetDate = date ?? tomorrowJst();
  const existing = await db
    .collection(COLLECTIONS.posts)
    .where('status', 'in', ['pending', 'approved'])
    .get();
  const already = new Set(
    existing.docs
      .map((d) => d.data())
      .filter((p) => (p.plannedDate ?? jstDateOf(p.scheduledAt)) === targetDate)
      .map((p) => p.accountId)
  );
  const todo = accounts.filter((a) => !already.has(a.id));
  for (const a of accounts.filter((x) => already.has(x.id))) {
    results.push({ account: a.name, result: 'skipped', reason: `${targetDate} ぶんは作成済み` });
  }

  const settled = await Promise.allSettled(
    todo.map((account) => generateForAccount(account, { date }))
  );
  settled.forEach((outcome, i) => {
    const account = todo[i];
    if (outcome.status === 'fulfilled') {
      const { posts, usage, persona, note } = outcome.value;
      results.push({
        account: account.name,
        result: 'ok',
        count: posts.length,
        note: note ?? null,
        usage,
        model: persona.model ?? null,
      });
    } else {
      results.push({ account: account.name, result: 'failed', reason: outcome.reason?.message ?? String(outcome.reason) });
    }
  });

  await db.collection(COLLECTIONS.runs).add({
    job: 'generate',
    startedAt,
    finishedAt: new Date().toISOString(),
    status: results.some((r) => r.result === 'failed') ? 'failed' : 'ok',
    message: results
      .filter((r) => r.result === 'failed')
      .map((r) => `${r.account}: ${r.reason}`)
      .join(' / '),
    results,
  });

  return { startedAt, results };
}
