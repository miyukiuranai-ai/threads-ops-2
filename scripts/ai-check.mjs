#!/usr/bin/env node
// Anthropic APIキーの疎通確認。ごく短い応答を1回だけ生成する。
// 使い方: npm run ai:check
import Anthropic from '@anthropic-ai/sdk';
import { loadEnv, requireEnv } from './lib/env.mjs';
import { MODEL } from '../lib/server/claude.mjs';

async function main() {
  loadEnv();
  requireEnv('ANTHROPIC_API_KEY', 'https://console.anthropic.com で発行して .env.local に記入する');

  const client = new Anthropic();

  console.log(`[1/1] ${MODEL} に接続 ...`);
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 128,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: '接続確認です。「OK」とだけ返してください。' }],
  });

  const text = res.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  console.log(`      応答: ${text || '(空)'}`);
  console.log(
    `      使用トークン: 入力${res.usage.input_tokens} / 出力${res.usage.output_tokens}`
  );
  console.log('\n✅ Anthropic API に接続できました。');
}

main().catch((err) => {
  if (err instanceof Anthropic.AuthenticationError) {
    console.error('\n失敗しました: APIキーが無効です。.env.local の ANTHROPIC_API_KEY を確認してください。');
  } else if (err instanceof Anthropic.RateLimitError) {
    console.error('\n失敗しました: レート制限または残高不足です。コンソールでクレジットを確認してください。');
  } else if (err instanceof Anthropic.APIError) {
    console.error(`\n失敗しました: APIエラー ${err.status} ${err.message}`);
  } else {
    console.error('\n失敗しました: ' + err.message);
  }
  process.exit(1);
});
