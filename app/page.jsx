import { listAccounts, countPostsByStatus, countPendingReplies, listRecentErrors, daysUntil } from '@/lib/server/repo.mjs';
import { getCurrentUser, filterAccountsForUser } from '@/lib/server/auth.mjs';
import { creditStatus, usd, WARN_DAYS } from '@/lib/server/cost.mjs';

export const dynamic = 'force-dynamic';

// 参考ツールの「担当」表示に対応する。Phase 2 の生成パイプラインの工程。
const STAGES = [
  { name: '調査担当', desc: '反応が出やすい構造を読み取り中' },
  { name: '見出し担当', desc: '読み始めたくなる一文を作成中' },
  { name: '文章担当', desc: '投稿本文を作成中' },
  { name: '品質確認', desc: '禁止語、古い日付、固有情報を確認中' },
  { name: '予定担当', desc: '投稿時刻へ割り当て中' },
];

function tokenTone(days) {
  if (days === null) return 'warn';
  if (days < 0) return 'danger';
  if (days < 10) return 'warn';
  return 'ok';
}

export default async function OverviewPage({ searchParams }) {
  const params = await searchParams;

  const user = await getCurrentUser();

  let accounts = [];
  let dbError = null;
  let credit = null;
  try {
    accounts = filterAccountsForUser(await listAccounts(), user);
  } catch (err) {
    dbError = err.message;
  }

  try {
    credit = await creditStatus();
  } catch {
    // 残高の記録が読めなくても、画面自体は出す
  }

  const selectedId = params?.account ?? accounts[0]?.id ?? null;
  const account = accounts.find((a) => a.id === selectedId) ?? null;

  let postCounts = {};
  let pendingReplies = 0;
  let errors = [];
  if (account) {
    // 3つを同時に投げる。ひとつ失敗しても画面全体は落とさない
    const [counts, pending, recent] = await Promise.allSettled([
      countPostsByStatus(account.id),
      countPendingReplies(account.id),
      listRecentErrors({ limit: 5 }),
    ]);
    if (counts.status === 'fulfilled') postCounts = counts.value;
    if (pending.status === 'fulfilled') pendingReplies = pending.value;
    if (recent.status === 'fulfilled') errors = recent.value;
    if (!dbError && counts.status === 'rejected') dbError = counts.reason?.message ?? null;
  }

  const tokenDays = daysUntil(account?.tokenExpiresAt);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{account ? `@${account.name}` : '全体状況'}</h1>
          <p className="page-desc">
            {account
              ? 'この名義の投稿生成と予約状況を表示します。'
              : '名義を連携すると、ここに状況が表示されます。'}
          </p>
        </div>
      </div>

      {credit && (credit.tone === 'warn' || credit.tone === 'danger') && (
        <div className="notice" style={{ borderLeftColor: credit.tone === 'danger' ? 'var(--danger)' : 'var(--warn)' }}>
          <strong>
            {credit.blocked
              ? 'Anthropic の残高が足りず、投稿文の生成が止まりました。'
              : credit.remaining <= 0
                ? 'Anthropic の残高が尽きています。'
                : 'Anthropic の残高がまもなく尽きます。'}
          </strong>
          <div style={{ marginTop: 6 }}>
            {credit.configured ? (
              <>
                残り {usd(credit.remaining)}
                {credit.daysLeft !== null &&
                  `（このペースで約${Math.floor(credit.daysLeft)}日ぶん・1日あたり ${usd(credit.perDay)}）`}
                。切れると毎日の生成（15:30ごろ）が止まります。
              </>
            ) : (
              '切れると毎日の生成（15:30ごろ）が止まります。'
            )}
            <br />
            <a href="https://platform.claude.com/settings/billing" target="_blank" rel="noreferrer">
              Claude Console の請求ページ
            </a>
            で入金し、設定画面で残高を入れ直してください。
          </div>
        </div>
      )}

      {dbError && (
        <div className="notice">
          <strong>Firestore に接続できていません。</strong>
          <div style={{ marginTop: 6 }}>{dbError}</div>
          <div style={{ marginTop: 6 }}>
            <code>SETUP-FIREBASE.md</code> を確認し、<code>npm run db:check</code> が通る状態にしてください。
          </div>
        </div>
      )}

      {!dbError && accounts.length === 0 && (
        <div className="notice">
          <strong>連携済みの名義がありません。</strong>
          <div style={{ marginTop: 6 }}>
            <code>npm run token:import</code> でトークンを取り込み、<code>npm run db:import-accounts</code> で
            Firestore に登録してください。
          </div>
        </div>
      )}

      <div className="grid grid-5" style={{ marginBottom: 20 }}>
        <div className="stat">
          <div className="stat-label">承認待ちの投稿</div>
          <div className="stat-value">{postCounts.pending ?? 0}</div>
          <div className="stat-note">確認が必要です</div>
        </div>
        <div className="stat">
          <div className="stat-label">予約済みの投稿</div>
          <div className="stat-value">{postCounts.scheduled ?? 0}</div>
          <div className="stat-note">投稿時刻を待機中</div>
        </div>
        <div className="stat">
          <div className="stat-label">投稿済み</div>
          <div className="stat-value">{postCounts.posted ?? 0}</div>
          <div className="stat-note">累計</div>
        </div>
        <div className="stat">
          <div className="stat-label">未処理のリプライ</div>
          <div className="stat-value">{pendingReplies}</div>
          <div className="stat-note">Phase 3 で稼働</div>
        </div>
        <div className="stat">
          <div className="stat-label">トークン期限</div>
          <div className="stat-value">{tokenDays === null ? '—' : `${tokenDays}日`}</div>
          <div className="stat-note">
            <span className="badge" data-tone={tokenTone(tokenDays)}>
              {tokenDays === null
                ? '不明'
                : tokenDays < 0
                  ? '失効済み'
                  : tokenDays < 10
                    ? '要リフレッシュ'
                    : '正常'}
            </span>
          </div>
        </div>
      </div>

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            ✦ {account ? `@${account.name} ` : ''}投稿生成
            <small>投稿案の作成から予約表への追加までを表示します。</small>
          </div>
          <button className="btn btn-primary" disabled>
            生成を開始
          </button>
        </div>
        <div className="grid grid-5">
          {STAGES.map((s) => (
            <div className="stage" key={s.name}>
              <div className="stage-name">✻ {s.name}</div>
              <div className="stage-desc">{s.desc}</div>
              <div className="bar">
                <span />
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-2">
        <section className="card">
          <div className="card-head">
            <div className="card-title">✦ 生成ログ</div>
          </div>
          <div className="terminal">準備完了。</div>
        </section>

        <section className="card">
          <div className="card-head">
            <div className="card-title">✦ 投稿予定プレビュー</div>
          </div>
          <div className="empty">生成された投稿がここに入ります。</div>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            ✦ 直近のエラー <small>Cron の実行ログから抽出します。</small>
          </div>
        </div>
        {errors.length === 0 ? (
          <div className="stat-note">エラーはありません。</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>日時</th>
                <th>処理</th>
                <th>内容</th>
              </tr>
            </thead>
            <tbody>
              {errors.map((e) => (
                <tr key={e.id}>
                  <td>{e.startedAt ?? '-'}</td>
                  <td>{e.job ?? '-'}</td>
                  <td>{e.message ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
