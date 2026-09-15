// 日次レポート。npm run report -- [--date YYYY-MM-DD] [--dry]
import { main } from './_lib.mjs';
import { generateReport } from '../lib/server/report.mjs';
import { jstDate, addDays } from '../lib/server/time.mjs';
main(async (args) => generateReport(args.date || addDays(jstDate(), -1), { dry: Boolean(args.dry) }));
