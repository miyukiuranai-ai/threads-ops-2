// 認可 URL を出す。npm run auth:url
import { main, out } from './_lib.mjs';
import { authUrl, THREADS_SCOPES } from '../lib/server/threads.mjs';
main(async () => { out('ブラウザで開いて認可し、リダイレクト先の ?code= を控える:'); out(authUrl()); out(`権限: ${THREADS_SCOPES.join(', ')}`); });
