// その投稿が、画像なしでも成立するかを判定する。
//
// 画像の指示（imageBrief）が付いていても、多くは「あれば良い」程度で、
// 本文だけで読める。一方「この2つを見比べてください」のように
// 本文が画像を指している投稿は、画像がないと意味が通らない。
//
// 前者は画像がなくてもそのまま投稿し、後者だけ止める。

/** 本文が画像そのものを指している言い回し。 */
const REFERS_TO_IMAGE = [
  /画像/,
  /写真/,
  /この[0-9０-９一二三四五六七八九]+\s*(つ|個|枚|体)/,
  /見比べ/,
  /比べてみ/,
  /どちら(が|を|に)?\s*(選|惹|気にな)/,
  /上の/,
  /下の/,
  /こちらを?見/,
  /貼っ(て|た)/,
  /映(っ|る)/,
  /写(っ|る)/,
];

/**
 * 画像が必須か。
 * @param {object} post 投稿
 * @returns {boolean} true なら画像が揃うまで投稿しない
 */
export function needsImage(post) {
  if (!post?.imageBrief) return false;

  // 生成時に判定が付いていればそれを使う
  if (typeof post.imageRequired === 'boolean') return post.imageRequired;

  // 古い投稿は本文から推定する
  const body = String(post.body ?? '');
  return REFERS_TO_IMAGE.some((re) => re.test(body));
}
