// 送信待ちの返信を送る。npm run replies:send [-- --max 5]
import { main } from './_lib.mjs';
import { sendReplies } from '../lib/server/replies.mjs';
main(async (args) => sendReplies({ max: Number(args.max || 5) }));
