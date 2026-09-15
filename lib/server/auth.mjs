// 画面（サーバーコンポーネント）から使う利用者情報。
// next/headers に依存するため、コマンドからは auth-core.mjs を使うこと。
import { headers } from 'next/headers';
import { USER_HEADERS } from './auth-core.mjs';

export {
  DEFAULT_GROUP,
  USER_HEADERS,
  parseMembers,
  findUser,
  isAuthConfigured,
  filterAccountsForUser,
  groupMembers,
  groupLabel,
  groupAccounts,
} from './auth-core.mjs';

/** いま画面を見ている利用者。認証が未設定なら管理者として扱う。 */
export async function getCurrentUser() {
  const h = await headers();
  const name = h.get(USER_HEADERS.name);
  if (!name) return { name: 'local', role: 'admin', group: null };

  const role = h.get(USER_HEADERS.role) === 'admin' ? 'admin' : 'member';
  return { name, role, group: role === 'admin' ? null : h.get(USER_HEADERS.group) };
}
