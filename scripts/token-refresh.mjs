// トークンの延長。npm run token:refresh [-- --force]
import { main } from './_lib.mjs';
import { refreshTokens } from '../lib/server/tokens.mjs';
main(async (args) => refreshTokens({ force: Boolean(args.force) }));
