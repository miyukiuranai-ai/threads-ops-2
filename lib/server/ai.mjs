// Anthropic API の呼び出し。既定は claude-opus-5、名義ごとに claude-sonnet-5 を選べる。
import Anthropic from '@anthropic-ai/sdk';
import { env } from './env.mjs';

export const DEFAULT_MODEL = 'claude-opus-5';
export const MODELS = ['claude-opus-5', 'claude-sonnet-5'];

let _client;
export function client() {
  if (!_client) {
    if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY が未設定です');
    _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 });
  }
  return _client;
}

export function pickModel(m) {
  return MODELS.includes(m) ? m : DEFAULT_MODEL;
}

/** 1 回の呼び出し。{text, usage, model} を返す */
export async function complete({ model, system, user, maxTokens = 8000, effort = 'medium', messages }) {
  const m = pickModel(model);
  const res = await client().messages.create({
    model: m,
    max_tokens: maxTokens,
    system,
    output_config: { effort },
    messages: messages || [{ role: 'user', content: user }],
  });
  if (res.stop_reason === 'refusal') {
    throw new Error(`生成が拒否されました: ${res.stop_details?.explanation || res.stop_details?.category || ''}`);
  }
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return { text, usage: usageOf(res, m), model: m, stopReason: res.stop_reason, raw: res };
}

export function usageOf(res, model) {
  const u = res?.usage || {};
  return {
    model,
    inputTokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
    outputTokens: u.output_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
  };
}

/** JSON だけを取り出す（前後の説明やコードフェンスを許す） */
export function parseJson(text) {
  if (!text) throw new Error('空の応答');
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  try { return JSON.parse(t); } catch { /* fallthrough */ }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return JSON.parse(t.slice(start, end + 1));
  }
  throw new Error('JSON を取り出せませんでした: ' + t.slice(0, 200));
}

/** 費用の見積もり（円）。Opus 約15円、Sonnet 約6円 / 1回（入力1万・出力2千）を基準に按分 */
export const PRICE_USD_PER_M = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
};
export function estimateUsd(usage) {
  if (!usage) return 0;
  const p = PRICE_USD_PER_M[usage.model] || PRICE_USD_PER_M[DEFAULT_MODEL];
  return (usage.inputTokens || 0) / 1e6 * p.input + (usage.outputTokens || 0) / 1e6 * p.output;
}
export function sumUsage(list) {
  const out = { inputTokens: 0, outputTokens: 0, usd: 0, calls: 0 };
  for (const u of list || []) {
    if (!u) continue;
    out.inputTokens += u.inputTokens || 0;
    out.outputTokens += u.outputTokens || 0;
    out.usd += estimateUsd(u);
    out.calls += 1;
  }
  return out;
}
