// 運用の命令。npm run ops -- <命令> [--key value ...]
// list-drafts / directive / generate / edit-draft / delete-post / persona / lines
import { main } from './_lib.mjs';
import { runOps } from '../lib/server/ops.mjs';
main(async (args) => runOps(args._[0], args));
