// 気になるアカウントの控え。
//
// Threads API ではタイムラインを取れず、公開ページもサーバーからは中身が読めない。
// そのため「見つけるのは人、判定と分析は別で行い、結果をここに残す」形にしている。
// 名義とは違い、控えはツールを触る全員で共有する（隠す理由がないため）。
export const WATCHLIST_COLLECTION = 'watchlist';

/** 判定の状態。 */
export const WATCH_STATUS = {
  candidate: { label: '未判定', tone: 'warn' },
  competitor: { label: '競合', tone: 'danger' },
  reference: { label: '参考になる', tone: 'ok' },
  irrelevant: { label: '関係ない', tone: 'default' },
};

/** URL でも @名前 でも受け取って、ユーザー名だけを取り出す。 */
export function parseUsername(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;

  const fromUrl = /threads\.(?:net|com)\/@?([A-Za-z0-9._]+)/.exec(text);
  const name = fromUrl ? fromUrl[1] : text.replace(/^@/, '').split(/[/?#\s]/)[0];

  return /^[A-Za-z0-9._]{1,60}$/.test(name) ? name.toLowerCase() : null;
}

/** 画面に出すためのURL。 */
export function watchUrl(username) {
  return `https://www.threads.com/@${username}`;
}
