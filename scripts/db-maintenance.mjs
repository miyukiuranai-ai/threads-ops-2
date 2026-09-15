// 古い runs の削除など。npm run db:maintenance [-- --days 30]
import { main } from './_lib.mjs';
import { cleanupRuns } from '../lib/server/runs.mjs';
main(async (args) => ({ deletedRuns: await cleanupRuns({ days: Number(args.days || 30) }) }));
