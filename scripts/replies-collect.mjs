// コメントの取り込みと判定。npm run replies:collect
import { main } from './_lib.mjs';
import { collectReplies, classifyReplies } from '../lib/server/replies.mjs';
main(async () => ({ collect: await collectReplies(), classify: await classifyReplies() }));
