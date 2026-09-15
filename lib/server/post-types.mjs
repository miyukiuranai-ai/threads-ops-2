// 投稿の型（8つ）。段は super_buzz / buzz / personal の 3 段。
// ガイドの文言は仕様書（14-1）のとおり。生成のプロンプトにそのまま渡す。

export const TIERS = {
  super_buzz: '超バズ特化',
  buzz: 'バズ特化',
  personal: '属人',
};

export const POST_TYPES = {
  image_buzz: {
    key: 'image_buzz',
    name: '超バズ特化型（画像）',
    tier: 'super_buzz',
    purpose: 'バズ型のさらにバズ特化。画像が主役で本文は 1〜4行。届いていない名義の露出づくり',
    guide: [
      '画像ストックの在庫から imageGenre と imageKind（pair＝左右2枚のくっつけ／single＝1枚）を必ず選ぶ。imageRequired は true',
      '漢字の2枚は、左右に割れた1文字（福、縁、運、叶 など）が、指でくっつけると1つの字として現れる仕掛け。使うときは在庫の字から1つ選んで imageNote にその字を書き、本文はその字の意味に沿った一言にする（縁なら「途切れていたご縁が、また結ばれます」、財なら「お金の流れが、静かに戻ってきます」）。字そのものは本文に書かず、くっつけて初めて分かるようにする',
      '2枚（くっつけ）の本文: 1行目「2本の指でくっつけてみて✨」。2行目に良いことを一言（開運が、太陽のようにどっと降り注ぎます🌞）。または合図ひとつ（「⛩️」をおいた人から、聖域の力をお借りして視ていきます／そっと『🐍』を置けたら幸運のパワーを受け取り完了、更にいいねすると邪気退散）',
      '1枚の本文: 「いいねと🍀で「運氣」上がります」のように1〜2行。いいねと絵文字ひとつで完結させる',
      '字間を空けた表記（い い ね と 🍀 で「 運 氣 」上 が り ま す）を使ってよい',
      '名乗り・経歴・暦・長い説明は入れない。1〜4行',
      '合図を求めるなら絵文字ひとつ。求めなくてもよい（いいねだけの投稿として成立させてよい）',
    ],
  },
  buzz_engagement: {
    key: 'buzz_engagement',
    name: 'バズ特化型',
    tier: 'buzz',
    purpose: 'リーチ確保。アカウントの加速用',
    guide: [
      '日付・時刻・偶然性のいずれかを1行目に置く（例: 9月3日に、いま素通りしなかった方）',
      '「いいねできた人だけ」「これを見た人だけ」と、いいねを条件に組み込む',
      '良いことが起きると断定する。ぼかさない（お金の不安がほどける、悪縁が消える、など）',
      '即時性を数字で出す（早い方で22分後、15分以内に、など）',
      '求める行動は「いいね」を軸にする。コメントを求めるなら一語だけ、軽く添える程度にする',
      '短く保つ。3〜5行。字間を空けた表記を使ってよい',
      '画像を添える形も選んでよい。添えるなら imageBrief に具体に書き、本文が画像そのものを指すときだけ imageRequired を true',
      '次の形も選べる: ①早朝5〜9時に「時刻→まさか起きている方→今日の暦→短い時間帯だけ→合図ひとつ」（暦は「対象日の暦」にあるときだけ） ②「◯月◯日。このあたりで流れが変わる方が何人か視えています。全員ではないです。自分がそうなのか気になる方は、好きな動物（好きな絵文字）を置いて」 ③「朝なので言いますが、本日、涙を流しながら腰を抜かすほどの良いことが起きます。大丈夫。合図ひとつ」',
      'buzzTone=light の名義は煽りと数字の断定を使わない。挨拶、短い肯定、好きな絵文字を置いてもらう形',
    ],
  },
  reading_open: {
    key: 'reading_open',
    name: '霊視開始型（バズ系）',
    tier: 'buzz',
    purpose: 'コメントを集める。時刻を宣言して「今から視る」',
    guide: [
      '1行目は時刻の宣言（例: 15:30になりました。無料霊視に入ります。／夜の9時。こんな時間にここに導かれた人、少しだけ視ます）',
      '本名は不要、と一言。1人1人に深く向き合うので、真剣に自分と向き合いたい人だけ、と絞る',
      '合図はひとつ。【🐍】【🙏】のような絵文字か、「恋・仕事・人」から一つ選ばせる。生年月日を添えてもらってもよい',
      '受け付ける時間帯を書いてもよい（21:00〜24:00まで、など。枠の時刻から3時間ほど）',
      '締めは「必要な方だけ、お待ちしております」のように静かに。煽らない。8〜10行。名乗りや経歴は入れない',
    ],
  },
  attract_intro: {
    key: 'attract_intro',
    name: '属人型（名乗り・由来）',
    tier: 'personal',
    purpose: '集客。地域と人物を出し、読み切った人だけを残す',
    guide: [
      '冒頭2行で読者を絞る。全員に向けて書かない',
      '地名 → 肩書き（年数） → 名乗り（読み仮名）の順で名乗る',
      '「怖がられると思い、近しい人にしか話していなかった」という秘匿の告白を入れる',
      '能力を数字で具体化する（何ヶ月先から何年先まで、など）',
      '近い未来と遠い未来の見え方の差を、その人固有の比喩で表現する',
      '第三者の声を短く引用する',
      '最後に合言葉をコメントに置くよう促す。「優先します」で限定感を出す',
      '別の書き方として「物語型」がある。挫折や転機、誰かの言葉で、なぜ視るのかを語る。締めは「しんどい人はフォローだけ置いて。生年月日を書ける人は書いて」のように軽く。Personaに書かれた来歴の範囲で書き、作り話を足さない',
      '本文の最後に名前だけを一行置いて締めてもよい（署名）。名義の世界観にある比喩は毎回同じものを使い、ぶれさせない',
    ],
  },
  personal_note: {
    key: 'personal_note',
    name: '属人・素の型',
    tier: 'personal',
    purpose: '集客。名義の土地と人物が主語で、仕掛けを使わない',
    guide: [
      'お手本の骨格をそのまま使う。名乗りつきの短い自己開示、時刻を告げて霊視に入る、覚悟を問う、読み手の恨みを代弁して受け止める、など',
      '土地と名前は必ず名義のもの。年数や視える範囲を語るなら人物設定にある数字だけ',
      '合図はひとつ。土地名か絵文字。求めない締め（お声をくだされば）でもよい',
      '不安を言葉にしてから受け止める。煽らない。8〜16行',
    ],
  },
  shrine_visit: {
    key: 'shrine_visit',
    name: '寺社訪問型（県内）',
    tier: 'personal',
    purpose: '集客。名義の県の中の寺社に「来ています」',
    guide: [
      '骨格は土地移動型と同じ。違いは場所が名義の県の中であること',
      '1行目は「◯◯県◯◯寺におります」「今、◯◯市◯◯の麓におります」。寺社や場所は名義の県の中にある実在のもの',
      '「今、少し氣の流れが変わりました」と変化を一言 →「特に今日は、長く止まっていたことが動き出す方が何人か強く入ってきます」→「ご縁なのか、仕事なのか。そこまではまだ追っていません」',
      '合図は県名か市名。「妙に気になった方は『◯◯』とだけ残してください。今夜、少し視ます」',
      '名乗り・経歴・暦は入れない。9〜11行。同じ文面を絵文字や語尾だけ変えて使い回してよい',
      'この投稿には運用者がその土地の画像を付ける。imagePlace に「都道府県 画像に向く寺社や名所を2〜3個」を書く',
    ],
  },
  travel_note: {
    key: 'travel_note',
    name: '土地移動型（県外）',
    tier: 'personal',
    purpose: '集客。「本日は◯◯県にいます」で土地に縁のある人を呼ぶ',
    guide: [
      '1行目は「本日は◯◯県にいます」「今、◯◯県に来ています」。県名は名義の土地の近くで、行っていそうな場所。同じ県を短い期間に繰り返さない',
      '「朝から少し氣の流れが変わりました」「私の勘は当たります」のような、その土地で感じた変化を一言',
      '「特に今日、止まっていたものが動き始める方が何人か強く入ってきます」→「ご縁なのか、お仕事なのか。そこまではまだ追っておりません」',
      '合図はその県名。「なぜか今、この投稿が気になった方は『◯◯』とだけ残してください」',
      '締めは「これより、少し視てみます」のように短く。10〜12行。名乗りや経歴、暦は入れない',
      'この投稿には運用者がその土地の画像を付ける。imagePlace に「都道府県 画像に向く寺社や名所を2〜3個」を書く（例: 大阪府 住吉大社 大阪天満宮 難波神社）',
    ],
  },
  exclusion_hook: {
    key: 'exclusion_hook',
    name: '不安煽り型',
    tier: 'personal',
    purpose: '集客。読み手の不安を先に言葉にして、受け止める。弾くのが目的ではない',
    guide: [
      '1行目で、読み手がいま抱えている不安や痛みを言い当てる（「もう無理かも」と思った直後の方／粗末に扱われてきた方／答えを聞く覚悟のある方にしか届きません）',
      '煽ったままにしない。2〜4行目で受け止める（それは復讐ではなく、天が流れを整えるだけ／弱さではなく、持ちこたえた証）',
      '名乗りや経歴は出さない。短く、断定で言い切る。条件や保険をつけない',
      '合図はひとつ（土地名か絵文字）。求めない締めでもよい',
      '誇大な脅しはしない。不安は本人がすでに感じているものを言葉にするだけ。6〜12行',
    ],
  },
};

export const TYPE_KEYS = Object.keys(POST_TYPES);
export const SUPER_BUZZ_TYPES = ['image_buzz'];
export const BUZZ_TYPES = ['buzz_engagement', 'reading_open'];
export const PERSONAL_TYPES = ['attract_intro', 'personal_note', 'shrine_visit', 'travel_note', 'exclusion_hook'];
/** 運用者が土地の画像を付ける型（自動では付けない。保留にする） */
export const PLACE_IMAGE_TYPES = ['travel_note', 'shrine_visit'];
/** ストックの画像を「付けたり付けなかったり」する型 */
export const OPTIONAL_STOCK_IMAGE_TYPES = ['buzz_engagement', 'reading_open'];

export function tierOf(typeKey) {
  return POST_TYPES[typeKey]?.tier || 'personal';
}

export function typeName(typeKey) {
  return POST_TYPES[typeKey]?.name || typeKey || '';
}

export function isValidType(key) {
  return Boolean(POST_TYPES[key]);
}

/** 生成プロンプトに貼る型ガイド */
export function typeGuideText(keys) {
  return keys
    .filter(isValidType)
    .map((k) => {
      const t = POST_TYPES[k];
      return `### ${k}（${t.name}・${TIERS[t.tier]}）\n目的: ${t.purpose}\n${t.guide.map((g) => `- ${g}`).join('\n')}`;
    })
    .join('\n\n');
}

/** 旧い型名の読み替え */
export function normalizeType(key) {
  const map = { image: 'image_buzz', buzz: 'buzz_engagement', reading: 'reading_open', intro: 'attract_intro', travel: 'travel_note', shrine: 'shrine_visit', hook: 'exclusion_hook', note: 'personal_note' };
  if (!key) return null;
  if (POST_TYPES[key]) return key;
  return map[key] || null;
}

/** 落ち込み中のブースト型 */
export const BOOST_TYPES = ['buzz_engagement', 'reading_open'];

/** 1日の構成の型（useDayPatterns）。役割の並び */
export const DAY_PATTERNS = {
  intro_night: { name: '名乗りは深夜', roles: ['buzz', 'personal', 'intro_late'] },
  intro_morning: { name: '名乗りは朝', roles: ['intro_early', 'buzz', 'personal'] },
  calendar: { name: '暦の日', roles: ['calendar_buzz', 'personal', 'reading'], needsCalendar: true },
  quiet: { name: '静かな日', roles: ['personal', 'reading', 'personal'] },
  short: { name: '短い日', roles: ['buzz', 'buzz', 'personal'] },
  exclude: { name: '弾く日', roles: ['hook', 'buzz', 'personal'] },
  voice: { name: '声の日', roles: ['buzz', 'testimonial', 'personal'], needsTestimonial: true },
};

/** 役割 → 型 */
export function roleToType(role) {
  switch (role) {
    case 'buzz': case 'calendar_buzz': return 'buzz_engagement';
    case 'reading': return 'reading_open';
    case 'intro_late': case 'intro_early': case 'testimonial': return 'attract_intro';
    case 'hook': return 'exclusion_hook';
    case 'personal': return 'personal_note';
    default: return 'personal_note';
  }
}
