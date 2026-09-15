// 承認済みで予定時刻を過ぎた投稿を送る（相乗りの処理も）。npm run publish
import { main } from './_lib.mjs';
import { jobPublish } from '../lib/server/cron-jobs.mjs';
main(async () => jobPublish());
