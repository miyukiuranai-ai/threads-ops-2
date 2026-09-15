// 管理画面の利用者（Next.js に依存しない部分）。
// middleware・画面・コマンドのどこからでも読み込める。
//
// 環境変数:
//   ADMIN_USER / ADMIN_PASSWORD … 管理者。すべての名義を見られる
//   MEMBERS                     … 管理者以外。自分のグループの名義だけを見られる
//                                 形式: user:password:group をカンマ区切り
//                                 例: taro:pw123:teamB,hanako:pw456:teamC

/** 名義に group が無いときの既定値。 */
export const DEFAULT_GROUP = 'main';

/** middleware から画面へ利用者を伝えるためのヘッダ名。 */
export const USER_HEADERS = {
  name: 'x-tool-user',
  role: 'x-tool-role',
  group: 'x-tool-group',
};

/** MEMBERS を読み解く。 */
export function parseMembers(raw = process.env.MEMBERS) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, password, group] = entry.split(':');
      return { name, password, group: group || DEFAULT_GROUP, role: 'member' };
    })
    .filter((m) => m.name && m.password);
}

/** ID・パスワードから利用者を探す。管理者を先に照合する。 */
export function findUser(name, password) {
  const adminUser = process.env.ADMIN_USER;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (adminUser && adminPassword && name === adminUser && password === adminPassword) {
    return { name, role: 'admin', group: null };
  }

  const member = parseMembers().find((m) => m.name === name && m.password === password);
  return member ? { name: member.name, role: 'member', group: member.group } : null;
}

/** 認証が設定されているか（未設定ならローカル開発とみなして素通しする）。 */
export function isAuthConfigured() {
  return Boolean(process.env.ADMIN_USER && process.env.ADMIN_PASSWORD) || parseMembers().length > 0;
}

/** その利用者が見てよい名義だけに絞る。 */
export function filterAccountsForUser(accounts, user) {
  if (!user || user.role === 'admin') return accounts;
  return accounts.filter((a) => (a.group ?? DEFAULT_GROUP) === user.group);
}

/** グループごとの担当者名。MEMBERS から作る。 */
export function groupMembers() {
  const map = new Map();
  for (const m of parseMembers()) {
    if (!map.has(m.group)) map.set(m.group, []);
    map.get(m.group).push(m.name);
  }
  return map;
}

/** グループの表示名。「teamB（suzuki）」のように担当者を添える。 */
export function groupLabel(group) {
  const key = group || DEFAULT_GROUP;
  const owners = groupMembers().get(key) ?? [];
  if (owners.length) return `${key}（${owners.join('・')}）`;
  if (key === DEFAULT_GROUP) return `${key}（管理者）`;
  return key;
}

/**
 * 名義を担当者ごとにまとめる。
 * 管理者の画面で「どれが誰の名義か」を分けて出すために使う。
 */
export function groupAccounts(accounts) {
  const map = new Map();
  for (const a of accounts) {
    const key = a.group || DEFAULT_GROUP;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(a);
  }

  return [...map.entries()]
    .sort(([a], [b]) => {
      if (a === DEFAULT_GROUP) return -1;
      if (b === DEFAULT_GROUP) return 1;
      return a.localeCompare(b);
    })
    .map(([group, items]) => ({ group, label: groupLabel(group), accounts: items }));
}
