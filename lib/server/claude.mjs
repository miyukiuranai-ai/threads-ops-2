// Claude API クライアント（サーバー専用）。投稿文・返信文の生成で使う。
import Anthropic from '@anthropic-ai/sdk';

/** 既定のモデル。名義ごとに変えられる（persona.model）。 */
export const MODEL = 'claude-opus-5';

/** 名義に選ばせるモデルの候補。 */
export const MODELS = {
  'claude-opus-5': { label: '高品質（Opus）', note: '属人型など、言葉の密度が要る名義に' },
  'claude-sonnet-5': { label: '標準（Sonnet・費用約4割減）', note: 'バズ特化など、型の決まった名義に' },
};

const CLIENT_KEY = Symbol.for('threads-ops.anthropic');

/** Anthropic クライアントを返す（プロセス内で1つだけ生成）。 */
export function getClaude() {
  if (globalThis[CLIENT_KEY]) return globalThis[CLIENT_KEY];
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      '環境変数 ANTHROPIC_API_KEY が未設定です。https://console.anthropic.com で発行し .env.local に記入してください。'
    );
  }
  const client = new Anthropic();
  globalThis[CLIENT_KEY] = client;
  return client;
}

/**
 * テキストを1回生成する。
 * 安全性の判定で生成が拒否された場合に備え、サーバー側フォールバックを有効にしている。
 */
export async function generateText({
  system,
  messages,
  maxTokens = 4096,
  effort = 'high',
  model = MODEL,
  outputFormat,
}) {
  const client = getClaude();
  const useModel = MODELS[model] ? model : MODEL;

  // サーバー側フォールバックは Opus 系だけが受け付ける。
  // Sonnet に付けると 400（does not support the `fallbacks` parameter）で落ちる
  const fallback = useModel.startsWith('claude-opus')
    ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }
    : {};

  const res = await client.beta.messages.create({
    model: useModel,
    max_tokens: maxTokens,
    ...fallback,
    system,
    messages,
    output_config: outputFormat ? { effort, format: outputFormat } : { effort },
  });

  if (res.stop_reason === 'refusal') {
    throw new Error(
      `生成が拒否されました (${res.stop_details?.category ?? '理由不明'})。プロンプトまたはPersonaの内容を見直してください。`
    );
  }

  const text = res.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  return { text, usage: res.usage, model: res.model };
}
