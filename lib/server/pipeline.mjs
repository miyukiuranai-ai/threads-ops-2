// 1 日の組み立て（generateForAccount）。名義の Persona を読み、本数・枠・型を決め、Claude に生成させ、posts に pending で保存する。
import { getPersonaForAccount } from './accounts.mjs';
import { directivesFor } from './directives.mjs';
import { detectSlump } from './slump.mjs';
import { pickSlots, parseRange, pickInRange, rng } from './schedule.mjs';
import { POST_TYPES, DAY_PATTERNS, roleToType, normalizeType, BOOST_TYPES, PLACE_IMAGE_TYPES, OPTIONAL_STOCK_IMAGE_TYPES, tierOf } from './post-types.mjs';
import { GENERATION_SYSTEM, buildUserPrompt } from './prompts.mjs';
import { complete, parseJson } from './ai.mjs';
import { pickReferencesForDay, noAskReferences } from './references.mjs';
import { winners, dailyMaxViews, hasBigPostSince } from './history.mjs';
import { recentPostsForPrompt, usedKeywords, askCountOn, recentDayPatterns, createPost, hasPostsForDate, rejectPendingForDate, listPosts } from './posts.mjs';
import { calendarText, hasNamedDay } from './calendar.mjs';
import { pickUnusedTestimonial, markUsed } from './testimonials.mjs';
import { getDoc } from './firebase.mjs';
import { addDays, jstDate, WEEKDAYS_JA, slotToMinutes } from './time.mjs';
import { cleanBody, cleanKeyword, keywordLooksSimple } from './text-clean.mjs';
import { usableStock, summarizeGenres, pickStock, findPlaceStock, markStockUsed, stockToMedia } from './stock.mjs';
import { signupsSince } from './signups.mjs';
import { latestVerdict, VERDICT_JA, getLines } from './impressions.mjs';

/** 集客が来ているか */
export async function hasAudience(account, persona, today) {
  if (persona.hasAudience === true) return true;
  if ((await signupsSince(account.id, 30, today)) > 0) return true;
  if (await hasBigPostSince(account.id, 30, today, 1000)) return true;
  return false;
}

/** 超バズを差し込む規則（15:30 の生成） */
async function superBuzzRule(account, persona, date, { audience }) {
  if (persona.noSuperBuzz) return { mode: null };
  const daily = await dailyMaxViews(account.id, 8, date);
  const days = [];
  for (let i = 1; i <= 7; i++) {
    const d = addDays(date, -i);
    if (daily[d] == null) continue; // 休んだ日は数えない
    days.push(daily[d]);
  }
  if (!audience) {
    const n = Number(persona.superBuzzOnlyAfterDays ?? 3);
    if (n > 0 && days.length >= n && days.slice(0, n).every((v) => v < 300)) return { mode: 'only', reason: `${n}日つづけて日の最高が300未満` };
  } else {
    const n = Number(persona.superBuzzAfterDays ?? 2);
    if (n > 0 && days.length >= n && days.slice(0, n).every((v) => v < 1000)) return { mode: 'one', reason: `${n}日つづけて日の最高が1,000未満` };
  }
  return { mode: null };
}

function decideCount({ directive, dayMix, slump, persona, random, superBuzz }) {
  if (directive?.action === 'rest') return { count: 0, why: '指示: 休む' };
  if (directive?.action === 'one' || directive?.action === 'one_buzz') return { count: 1, why: `指示: ${directive.action}` };
  if (directive?.action === 'two') return { count: 2, why: '指示: 2本' };
  if (directive?.action === 'mix' && directive.types?.length) return { count: directive.types.length, why: '指示: 構成' };
  if (directive?.action === 'keep') return { count: pickInRange(parseRange(persona.postsPerDay, [2, 5]), random), why: '指示: そのまま' };
  if (slump?.slump) {
    if (random() < 0.25) return { count: 0, why: '落ち込み中: 4回に1回は休む' };
    return { count: Number(persona.slumpPosts || 1), why: '落ち込み中' };
  }
  let count = pickInRange(parseRange(persona.postsPerDay, [2, 5]), random);
  if (superBuzz?.mode === 'one' && count < 3) count = 3;
  return { count, why: 'postsPerDay' };
}

/** dayMix を比率として count 本に繰り返す */
function expandMix(mix, count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(mix[i % mix.length]);
  return out;
}

function choosePattern({ persona, date, random, recentPatterns, hasTestimonial }) {
  if (!persona.useDayPatterns) return null;
  const cal = hasNamedDay(date);
  let keys = Object.keys(DAY_PATTERNS).filter((k) => {
    const p = DAY_PATTERNS[k];
    if (p.needsCalendar && !cal) return false;
    if (p.needsTestimonial && !hasTestimonial) return false;
    return !recentPatterns.includes(k);
  });
  if (!keys.length) keys = Object.keys(DAY_PATTERNS).filter((k) => !DAY_PATTERNS[k].needsCalendar || cal);
  if (cal && keys.includes('calendar') && random() < 0.6) return 'calendar';
  return keys[Math.floor(random() * keys.length)];
}

/**
 * 型の割り当て。優先: 手指定 types > 指示 mix > dayMix（比率） > 超バズ規則 > 落ち込み > 帯の型 > 構成の型 > dayTypes。
 * 型をどの時間帯に置くかは日ごとにランダム。
 */
function assignTypes({ slots, persona, directive, forcedTypes, slump, superBuzz, pattern, random, testimonial }) {
  const n = slots.length;
  let types = null;
  let source = '';
  let roles = null;
  if (forcedTypes?.length) { types = expandMix(forcedTypes, n); source = 'manual'; }
  else if (directive?.action === 'one_buzz') { types = ['buzz_engagement']; source = 'directive'; }
  else if (directive?.action === 'mix' && directive.types?.length) { types = expandMix(directive.types, n); source = 'directive'; }
  else if (persona.dayMix?.length) { types = expandMix(persona.dayMix.map(normalizeType).filter(Boolean), n); source = 'dayMix'; }
  else if (superBuzz?.mode === 'only') { types = Array(n).fill('image_buzz'); source = 'superBuzzOnly'; }
  else if (slump?.slump) {
    const boost = normalizeType(persona.slumpType) || 'buzz_engagement';
    types = Array(n).fill(boost);
    if (n >= 2) types[0] = 'buzz_engagement';
    source = 'slump';
  } else if (pattern) {
    roles = DAY_PATTERNS[pattern].roles;
    types = Array.from({ length: n }, (_, i) => roleToType(roles[i % roles.length]));
    source = 'pattern';
  } else {
    const bandTypes = slots.map((s) => s.type);
    const dayTypes = (persona.dayTypes || []).map(normalizeType).filter(Boolean);
    types = bandTypes.map((t, i) => t || dayTypes[i % Math.max(1, dayTypes.length)] || 'personal_note');
    source = 'bands';
  }
  if (!types?.length) types = Array(n).fill('personal_note');
  // 超バズを 1 本挟む（集客が来ている名義）。属人とバズ特化を 1 本ずつ残す
  if (superBuzz?.mode === 'one' && !['manual', 'directive', 'dayMix'].includes(source) && n >= 3) {
    types[0] = 'image_buzz';
    if (!types.some((t) => tierOf(t) === 'buzz')) types[1] = 'buzz_engagement';
    if (!types.some((t) => tierOf(t) === 'personal')) types[n - 1] = 'personal_note';
    source += '+superBuzz';
  }
  // buzzTrial: 最後の枠以外の 1 枠をバズ型
  if (persona.buzzTrial && !['manual', 'directive', 'dayMix', 'slump', 'superBuzzOnly'].includes(source) && n >= 2 && !types.includes('buzz_engagement') && !types.includes('image_buzz')) {
    types[Math.floor(random() * (n - 1))] = 'buzz_engagement';
  }
  // 日ごとにランダムに並べ替え（手指定・指示は順を守る）
  if (!['manual', 'directive'].includes(source)) {
    for (let i = types.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [types[i], types[j]] = [types[j], types[i]]; }
  }
  // 声の日: 2 本目の枠で口コミを使う
  const out = slots.map((s, i) => ({ ...s, type: types[i], role: roles ? roles[i % roles.length] : null }));
  if (testimonial && n >= 2) {
    const idx = Math.min(1, n - 1);
    out[idx].testimonial = testimonial.text;
    out[idx].testimonialId = testimonial.id;
    if (tierOf(out[idx].type) !== 'personal') out[idx].type = 'attract_intro';
  }
  return { slots: out, source, pattern };
}

async function lastResultText(accountId, lines) {
  const h = await latestVerdict(accountId);
  if (!h) return null;
  return `直前の投稿（${(h.text || '').split('\n')[0].slice(0, 30)}…）: 3時間後の表示 ${h.snap3h?.views ?? '-'}、判定「${VERDICT_JA[h.verdict3h] || h.verdict3h}」（線: 悪い<${lines.bad} / 良い>=${lines.good} / バズ>=${lines.buzz}）`;
}

/** 生成された 1 本に画像の扱いを決める */
async function decideImage(post, { account, persona, stock, lastHadImage, forceStock }) {
  const out = { media: [], stockId: null, status: 'pending', holdReason: null, imageBrief: post.imageBrief || '' };
  const t = post.type;
  if (t === 'image_buzz') {
    const kind = post.imageKind === 'pair' ? 'pair' : (post.imageKind === 'single' ? 'single' : undefined);
    let s = await pickStock({ accountId: account.id, kind, genre: post.imageGenre, note: post.imageNote });
    if (!s && forceStock) s = await pickStock({ accountId: account.id, fallbackAny: true });
    if (s) {
      out.media = stockToMedia(s);
      out.stockId = s.id;
      out.imageKind = s.kind; out.imageGenre = s.genre; out.imageNote = s.note;
    } else {
      out.status = 'held';
      out.holdReason = '画像が未準備（ストックに合う系統がありません）';
    }
    out.imageRequired = true;
    return out;
  }
  if (PLACE_IMAGE_TYPES.includes(t)) {
    const place = post.imagePlace || '';
    const hint = place ? `${place.split(/\s+/)[0]}の画像を入れてください（${place.split(/\s+/).slice(1).join('、') || '寺社や名所'}など）` : 'その土地の画像を入れてください（寺社や名所）';
    const matches = await findPlaceStock(account.id, place);
    out.imageBrief = matches.length ? `${hint}。ストックに候補: ${matches.map((m) => m.note || m.genre).join('、')}` : hint;
    out.status = 'held';
    out.holdReason = '画像が未準備（土地の画像を人が付ける）';
    out.imageRequired = true;
    return out;
  }
  if (OPTIONAL_STOCK_IMAGE_TYPES.includes(t)) {
    // 直前に画像が付いていたら次は付けない
    if (!lastHadImage.value) {
      const s = await pickStock({ accountId: account.id, kind: 'single', genre: post.imageGenre || undefined, placeSpecific: false, fallbackAny: true });
      if (s) { out.media = stockToMedia(s); out.stockId = s.id; out.imageGenre = s.genre; lastHadImage.value = true; return out; }
    }
    lastHadImage.value = false;
    if (post.imageRequired && !out.media.length) { out.status = 'held'; out.holdReason = '画像が未準備（本文が画像を指しています）'; }
    return out;
  }
  // 属人型にはストックの画像を付けない
  lastHadImage.value = false;
  if (post.imageRequired) { out.status = 'held'; out.holdReason = '画像が未準備（本文が画像を指しています）'; }
  return out;
}

/**
 * 名義 1 つの 1 日ぶんを作る。
 * opts: { date, types, slots, dry, instruction, force, generatedBy, autoApprove, switchedFrom, switchReason, forceStock, lockedType }
 */
export async function generateForAccount(account, opts = {}) {
  const date = opts.date || addDays(jstDate(), 1);
  const persona = await getPersonaForAccount(account);
  const seed = Number(date.replace(/-/g, '')) * 31 + [...(account.id || '')].reduce((s, c) => s + c.charCodeAt(0), 0) + (opts.seed || Date.now() % 100000);
  const random = rng(seed);
  const log = [];

  if (!opts.force && !opts.slots && (await hasPostsForDate(account.id, date))) {
    return { account: account.name, date, skipped: true, message: '作成済み' };
  }
  if (opts.force && !opts.slots) {
    const n = await rejectPendingForDate(account.id, date, '作り直し');
    if (n) log.push(`作り直し: ${n}本を却下`);
  }

  const { own, all } = await directivesFor(account.id, date);
  const directive = own || (all && all.action !== 'note' ? all : null);
  const directiveText = [own?.instruction, all?.instruction].filter(Boolean).join('\n');

  const slump = await detectSlump(account.id, date);
  const audience = await hasAudience(account, persona, date);
  const forcedTypes = (opts.types || []).map(normalizeType).filter(Boolean);
  const manual = forcedTypes.length > 0 || Boolean(opts.slots?.length);
  const decidedByReply = directive && directive.action && directive.action !== 'note';
  const superBuzz = manual || decidedByReply || persona.noSuperBuzz ? { mode: null } : await superBuzzRule(account, persona, date, { audience });

  // 本数
  let count;
  if (opts.slots?.length) count = opts.slots.length;
  else if (forcedTypes.length && !opts.slots) count = forcedTypes.length;
  else ({ count } = decideCount({ directive, slump, persona, random, superBuzz }));
  if (count <= 0) return { account: account.name, date, count: 0, message: '休む', slump, superBuzz };

  // 枠
  let slots;
  if (opts.slots?.length) slots = opts.slots.map((s) => ({ slot: s, type: null }));
  else slots = pickSlots(persona, count, { random });
  slots.sort((a, b) => slotToMinutes(a.slot) - slotToMinutes(b.slot));

  // 1 日の構成の型
  const hasMix = Boolean(persona.dayMix?.length) || (directive?.action === 'mix') || forcedTypes.length;
  const testimonial = !manual && random() < 0.25 ? await pickUnusedTestimonial(account.id) : null;
  const recentPatterns = await recentDayPatterns(account.id, date);
  const pattern = !hasMix && !slump.slump && superBuzz.mode !== 'only' ? choosePattern({ persona, date, random, recentPatterns, hasTestimonial: Boolean(testimonial) }) : null;
  const assigned = assignTypes({ slots, persona, directive, forcedTypes, slump, superBuzz, pattern, random, testimonial: pattern === 'voice' || (testimonial && !pattern) ? testimonial : null });
  slots = assigned.slots;

  // 合言葉の本数（前日と交互）
  const [askMin, askMax] = parseRange(persona.askPerDay, [2, 3]);
  const prevAsk = await askCountOn(account.id, addDays(date, -1));
  let askCount = prevAsk >= askMax ? askMin : (prevAsk > 0 && prevAsk <= askMin ? askMax : pickInRange([askMin, askMax], random));
  askCount = Math.min(askCount, slots.length);
  if (opts.slots?.length === 1) askCount = Math.min(1, askCount);

  // 材料
  const typeKeys = [...new Set(slots.map((s) => s.type))];
  const refs = await pickReferencesForDay(typeKeys, date);
  const noAskRefs = askCount < slots.length ? await noAskReferences() : [];
  const winnersList = persona.reuseWinners ? await winners(account.id, { from: persona.winnersFrom || undefined, to: persona.winnersTo || undefined }) : [];
  const recent = await recentPostsForPrompt(account.id, { limit: 8 });
  const used = await usedKeywords(account.id, { limit: 12 });
  const learnings = await recentLearnings(account.name, date);
  const calendar = (pattern === 'calendar' || typeKeys.includes('travel_note') || typeKeys.includes('buzz_engagement')) ? calendarText(date) : null;
  const stockAll = await usableStock(account.id);
  const stock = { genres: summarizeGenres(stockAll) };
  const optionalImages = summarizeGenres(stockAll.filter((s) => s.kind === 'single' && !s.placeSpecific));
  const lines = await getLines();
  const lastResult = await lastResultText(account.id, lines);
  const weekday = WEEKDAYS_JA[new Date(date + 'T00:00:00+09:00').getDay()];

  const ctx = {
    persona, accountName: account.name, date, weekdayLabel: weekday,
    slots: slots.map((s) => ({ slot: s.slot, type: s.type, role: s.role, note: persona.reuseWinners ? '骨格を写す' : null, testimonial: s.testimonial })),
    refs: refs._any ? Object.fromEntries(typeKeys.map((k) => [k, refs._any])) : refs,
    noAskRefs, winners: winnersList, recent, askCount, calendar,
    dayPattern: pattern ? DAY_PATTERNS[pattern] : null,
    directive: directiveText, instruction: opts.instruction || null,
    usedKeywords: used, learnings, stock, optionalImages: typeKeys.some((k) => OPTIONAL_STOCK_IMAGE_TYPES.includes(k)) ? optionalImages : [],
    lastResult,
  };
  const user = buildUserPrompt(ctx);

  if (opts.dry) {
    return { account: account.name, date, count: slots.length, slots, pattern, askCount, slump, superBuzz, audience, prompt: { system: GENERATION_SYSTEM, user }, dry: true };
  }

  const res = await complete({ model: persona.model, system: GENERATION_SYSTEM, user, maxTokens: 6000 });
  let parsed;
  try { parsed = parseJson(res.text); } catch (e) { throw new Error(`生成結果の JSON が読めません（${account.name}）: ${e.message}`); }
  const posts = Array.isArray(parsed.posts) ? parsed.posts : [];
  if (!posts.length) throw new Error(`生成結果が空です（${account.name}）`);

  // 後処理と保存
  const saved = [];
  let keywordsGiven = 0;
  const lastHadImage = { value: await lastPostHadImage(account.id) };
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const p = posts[i] || posts[posts.length - 1];
    const body = cleanBody(p.body || '');
    if (!body) continue;
    let keyword = cleanKeyword(p.keyword);
    if (keyword && !keywordLooksSimple(keyword) && !PLACE_IMAGE_TYPES.includes(s.type)) keyword = null;
    if (keyword) { keywordsGiven++; if (keywordsGiven > askCount) keyword = null; }
    const type = normalizeType(p.type) || s.type;
    const draft = {
      ...p, type, imageKind: p.imageKind || null, imageGenre: p.imageGenre || null, imageNote: p.imageNote || null, imagePlace: p.imagePlace || null,
      imageRequired: Boolean(p.imageRequired),
    };
    const img = await decideImage(draft, { account, persona, stock: stockAll, lastHadImage, forceStock: opts.forceStock });
    const doc = await createPost({
      accountId: account.id, accountName: account.name, personaId: persona.id || account.personaId,
      body, type, slot: s.slot, slotName: String(p.slotName || type).toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      keyword, imageBrief: img.imageBrief, imageRequired: img.imageRequired ?? draft.imageRequired,
      imageKind: img.imageKind ?? draft.imageKind, imageGenre: img.imageGenre ?? draft.imageGenre, imageNote: img.imageNote ?? draft.imageNote, imagePlace: draft.imagePlace,
      stockId: img.stockId, media: img.media, intent: p.intent || '',
      status: img.status, holdReason: img.holdReason,
      plannedDate: date, dayPattern: pattern, testimonialId: s.testimonialId || null,
      generatedBy: opts.generatedBy || 'cron', autoApprove: Boolean(opts.autoApprove), switchedFrom: opts.switchedFrom || null, switchReason: opts.switchReason || null,
      lockedType: Boolean(opts.lockedType),
    });
    if (img.stockId) await markStockUsed(img.stockId, account.id, doc.id);
    if (s.testimonialId) await markUsed(s.testimonialId, doc.id);
    saved.push(doc);
  }
  return {
    account: account.name, date, count: saved.length, posts: saved.map((d) => ({ id: d.id, slot: d.slot, type: d.type, status: d.status, keyword: d.keyword })),
    pattern, askCount, slump, superBuzz, audience, typeSource: assigned.source, usage: res.usage, log,
  };
}

async function lastPostHadImage(accountId) {
  const list = await listPosts({ accountId, statuses: ['posted', 'approved', 'pending'], limit: 50 });
  list.sort((a, b) => (b.scheduledAt || '').localeCompare(a.scheduledAt || ''));
  const last = list[0];
  return Boolean(last?.media?.length);
}

/** レポートの続ける・やめる（直近 3 日） */
export async function recentLearnings(accountName, date) {
  const keep = [], stop = [];
  for (let i = 1; i <= 3; i++) {
    const r = await getDoc('reports', addDays(date, -i));
    const a = (r?.accounts || []).find((x) => x.account === accountName || x.account === `@${accountName}`);
    if (a) { keep.push(...(a.keep || [])); stop.push(...(a.stop || [])); }
  }
  return { keep: [...new Set(keep)].slice(0, 6), stop: [...new Set(stop)].slice(0, 6) };
}

/** 全名義を並列に作る（作成済みは飛ばす）。名義単位で例外を閉じ込める */
export async function generateForAll(accounts, opts = {}) {
  const results = await Promise.all(accounts.map(async (acc) => {
    try {
      return await generateForAccount(acc, opts);
    } catch (e) {
      return { account: acc.name, date: opts.date, error: String(e.message || e) };
    }
  }));
  return results;
}
