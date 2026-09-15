// Anthropic API の確認。npm run ai:check
import { main } from './_lib.mjs';
import { complete } from '../lib/server/ai.mjs';
main(async (args) => complete({ model: args.model, system: '短く答える。', user: '「準備できています」とだけ返してください。', maxTokens: 50, effort: 'low' }).then((r) => ({ text: r.text, usage: r.usage })));
