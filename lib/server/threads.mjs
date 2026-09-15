// Threads Graph API の薄いラッパー。
// Phase 2 以降のサーバー実装からも流用できるよう、副作用（環境変数の読み込み等）は持たせない。

export const GRAPH_BASE = 'https://graph.threads.net';
export const GRAPH_VERSION = 'v1.0';
export const AUTHORIZE_BASE = 'https://threads.net/oauth/authorize';

/** 認可画面のURLを組み立てる。 */
export function buildAuthorizeUrl({ appId, redirectUri, scopes, state }) {
  const url = new URL(AUTHORIZE_BASE);
  url.searchParams.set('client_id', appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', scopes.join(','));
  url.searchParams.set('response_type', 'code');
  if (state) url.searchParams.set('state', state);
  return url.toString();
}

class ThreadsApiError extends Error {
  constructor(message, { status, body, endpoint }) {
    super(message);
    this.name = 'ThreadsApiError';
    this.status = status;
    this.body = body;
    this.endpoint = endpoint;
  }
}

async function parseResponse(res, endpoint) {
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new ThreadsApiError(`レスポンスがJSONではありません: ${text.slice(0, 300)}`, {
      status: res.status,
      body: text,
      endpoint,
    });
  }
  if (!res.ok || json.error) {
    const err = json.error ?? {};
    const detail = [err.message, err.type, err.code && `code=${err.code}`, err.error_subcode && `subcode=${err.error_subcode}`]
      .filter(Boolean)
      .join(' / ');
    throw new ThreadsApiError(
      `Threads API エラー (HTTP ${res.status}) ${endpoint}\n  ${detail || JSON.stringify(json)}`,
      { status: res.status, body: json, endpoint }
    );
  }
  return json;
}

async function get(path, params) {
  const url = new URL(path.startsWith('http') ? path : `${GRAPH_BASE}${path}`);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, { method: 'GET' });
  return parseResponse(res, `GET ${url.pathname}`);
}

async function post(path, params) {
  const url = new URL(path.startsWith('http') ? path : `${GRAPH_BASE}${path}`);
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null) body.set(k, String(v));
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return parseResponse(res, `POST ${url.pathname}`);
}

/** 認可コード → 短期トークン（有効期限1時間）。 */
export function exchangeCodeForShortLivedToken({ appId, appSecret, redirectUri, code }) {
  return post('/oauth/access_token', {
    client_id: appId,
    client_secret: appSecret,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code,
  });
}

/** 短期トークン → 長期トークン（有効期限60日）。 */
export function exchangeForLongLivedToken({ appSecret, shortLivedToken }) {
  return get('/access_token', {
    grant_type: 'th_exchange_token',
    client_secret: appSecret,
    access_token: shortLivedToken,
  });
}

/** 長期トークンの延長（24時間以上経過かつ有効なトークンが対象。Phase 2の週次Cronで使用）。 */
export function refreshLongLivedToken({ accessToken }) {
  return get('/refresh_access_token', {
    grant_type: 'th_refresh_token',
    access_token: accessToken,
  });
}

/** 自分のプロフィールを取得。 */
export function getMe({ accessToken, fields = 'id,username,threads_profile_picture_url' }) {
  return get(`/${GRAPH_VERSION}/me`, { fields, access_token: accessToken });
}

/** テキスト投稿のメディアコンテナを作成（1段階目）。 */
export function createTextContainer({ accessToken, userId, text, replyControl }) {
  return post(`/${GRAPH_VERSION}/${userId}/threads`, {
    media_type: 'TEXT',
    text,
    reply_control: replyControl,
    access_token: accessToken,
  });
}

/** コンテナを公開（2段階目）。 */
export function publishContainer({ accessToken, userId, creationId }) {
  return post(`/${GRAPH_VERSION}/${userId}/threads_publish`, {
    creation_id: creationId,
    access_token: accessToken,
  });
}

/** 投稿済みスレッドの情報を取得。 */
export function getThread({ accessToken, threadId, fields = 'id,permalink,text,timestamp,media_type' }) {
  return get(`/${GRAPH_VERSION}/${threadId}`, { fields, access_token: accessToken });
}

export { ThreadsApiError };

/** 自分の投稿一覧を取得（分析の入力）。 */
export function listMyThreads({ accessToken, userId, limit = 25, since, until, after }) {
  return get(`/${GRAPH_VERSION}/${userId}/threads`, {
    fields: 'id,media_type,text,permalink,timestamp,is_quote_post',
    limit,
    since,
    until,
    after,
    access_token: accessToken,
  });
}

/** 投稿単位のインサイト（表示数・いいね等）。threads_manage_insights が必要。 */
export function getThreadInsights({
  accessToken,
  threadId,
  metrics = 'views,likes,replies,reposts,quotes,shares',
}) {
  return get(`/${GRAPH_VERSION}/${threadId}/insights`, {
    metric: metrics,
    access_token: accessToken,
  });
}

/** 投稿に付いたリプライ一覧。threads_read_replies が必要。 */
export function listReplies({ accessToken, threadId, limit = 25, after }) {
  return get(`/${GRAPH_VERSION}/${threadId}/replies`, {
    fields: 'id,text,username,timestamp,replied_to,is_reply_owned_by_me,has_replies,media_type',
    limit,
    after,
    access_token: accessToken,
  });
}

/** 公開投稿のキーワード検索。threads_keyword_search が必要。 */
export function keywordSearch({
  accessToken,
  query,
  searchType = 'TOP',
  searchMode = 'KEYWORD',
  limit = 25,
  after,
}) {
  return get(`/${GRAPH_VERSION}/keyword_search`, {
    q: query,
    // search_mode は KEYWORD か TAG のみ。省くと弾かれる
    search_mode: searchMode,
    search_type: searchType,
    fields: 'id,text,media_type,permalink,timestamp,username,has_replies,is_quote_post,is_reply',
    limit,
    after,
    access_token: accessToken,
  });
}

/** 公開アカウントのプロフィール。threads_profile_discovery が必要。 */
export function profileLookup({ accessToken, username }) {
  return get(`/${GRAPH_VERSION}/profile_lookup`, {
    username,
    fields: 'id,username,name,follower_count,biography,is_verified',
    access_token: accessToken,
  });
}

/**
 * コメントに返信する。threads_manage_replies が必要。
 * コンテナ作成直後は公開できないことがあるため、待機してから公開し、失敗したら数回やり直す。
 */
export async function createReply({ accessToken, userId, text, replyToId, waitMs = 5000, attempts = 3 }) {
  const container = await post(`/${GRAPH_VERSION}/${userId}/threads`, {
    media_type: 'TEXT',
    text,
    reply_to_id: replyToId,
    access_token: accessToken,
  });

  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    await new Promise((r) => setTimeout(r, waitMs * (i + 1)));
    try {
      return await post(`/${GRAPH_VERSION}/${userId}/threads_publish`, {
        creation_id: container.id,
        access_token: accessToken,
      });
    } catch (err) {
      lastError = err;
      // コンテナがまだ用意できていない場合だけやり直す
      const subcode = err.body?.error?.error_subcode;
      if (subcode !== 4279009) throw err;
    }
  }
  throw lastError;
}

/** 自分の投稿を削除する。threads_delete が必要。 */
export async function deleteThread({ accessToken, threadId }) {
  const url = new URL(`${GRAPH_BASE}/${GRAPH_VERSION}/${threadId}`);
  url.searchParams.set('access_token', accessToken);
  const res = await fetch(url, { method: 'DELETE' });
  return parseResponse(res, `DELETE /${threadId}`);
}

// ---------- 画像・動画の投稿 ----------
//
// 画像 : media_type=IMAGE + image_url
// 動画 : media_type=VIDEO + video_url（変換が終わるまで公開できない）
// 複数 : 子を is_carousel_item=true で作り、media_type=CAROUSEL + children でまとめる
//        枚数は2〜20枚（公式ドキュメント）

/** 画像1枚・動画1本のコンテナを作る。カルーセルの子にもこれを使う。 */
export function createMediaContainer({
  accessToken,
  userId,
  kind,
  url,
  text,
  isCarouselItem = false,
  replyControl,
}) {
  const params = {
    media_type: kind === 'video' ? 'VIDEO' : 'IMAGE',
    [kind === 'video' ? 'video_url' : 'image_url']: url,
    access_token: accessToken,
  };
  if (isCarouselItem) params.is_carousel_item = 'true';
  else {
    params.text = text;
    params.reply_control = replyControl;
  }
  return post(`/${GRAPH_VERSION}/${userId}/threads`, params);
}

/** 複数枚をまとめるコンテナを作る。 */
export function createCarouselContainer({ accessToken, userId, childIds, text, replyControl }) {
  return post(`/${GRAPH_VERSION}/${userId}/threads`, {
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    text,
    reply_control: replyControl,
    access_token: accessToken,
  });
}

/** コンテナの状態。FINISHED になるまで公開できない。 */
export function getContainerStatus({ accessToken, containerId }) {
  return get(`/${GRAPH_VERSION}/${containerId}`, {
    fields: 'status,error_message',
    access_token: accessToken,
  });
}

/**
 * コンテナの変換が終わるまで待つ。
 * 公式の案内どおり1分に1回、最大5分まで問い合わせる。
 */
export async function waitForContainer({
  accessToken,
  containerId,
  intervalMs = 60_000,
  maxWaitMs = 5 * 60_000,
}) {
  const deadline = Date.now() + maxWaitMs;

  for (;;) {
    const { status, error_message: errorMessage } = await getContainerStatus({
      accessToken,
      containerId,
    });

    if (status === 'FINISHED') return { status };
    if (status === 'ERROR' || status === 'EXPIRED') {
      throw new Error(`メディアの処理に失敗しました（${status}${errorMessage ? ': ' + errorMessage : ''}）。`);
    }
    if (Date.now() + intervalMs > deadline) {
      throw new Error(`メディアの処理が5分以内に終わりませんでした（${status}）。次の実行でやり直します。`);
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
