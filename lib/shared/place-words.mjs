// 系統の語から「場所が分かりそうな画像」を推し量る。画面（ブラウザ）とサーバーの両方から使うので、ここには import を置かない。
// 場所が分かる画像（鳥居、富士山、寺社など）は超バズ特化型だけに使い、バズ特化型・属人型には添えない（本人 9/12）。
export const PLACE_WORDS = /鳥居|神社|神宮|大社|寺|院|富士|城|駅|橋|滝|湖|岬|島|温泉|参道|拝殿|本殿|社/;

export function looksPlaceSpecific(genre = '', note = '') {
  return PLACE_WORDS.test(`${genre} ${note}`);
}
