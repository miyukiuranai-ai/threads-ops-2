// バケットの CORS。npm run storage:setup [-- --origin https://xxx.vercel.app]
import { main } from './_lib.mjs';
import { setupCors } from '../lib/server/storage.mjs';
main(async (args) => { await setupCors(args.origin ? String(args.origin).split(',') : ['*']); return { ok: true }; });
