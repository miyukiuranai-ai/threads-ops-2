// 名義ごとの状況。npm run db:status
import { main } from './_lib.mjs';
import { listAccounts, tokenDaysLeft } from '../lib/server/accounts.mjs';
import { countByStatus } from '../lib/server/posts.mjs';
import { countNewReplies } from '../lib/server/replies.mjs';
import { modeLabel } from '../lib/server/guard.mjs';
main(async () => {
  const accounts = await listAccounts();
  const counts = await countByStatus();
  const replies = await countNewReplies();
  const rows = [];
  for (const a of accounts) rows.push({ name: a.name, group: a.group, status: a.status, autoReply: a.autoReply, tokenDays: await tokenDaysLeft(a), ...(counts[a.id] || {}), newReplies: replies[a.id] || 0 });
  return { modes: modeLabel(), accounts: rows };
});
