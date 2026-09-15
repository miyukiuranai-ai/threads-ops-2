import { listAccounts, listRepliesForAccount } from '@/lib/server/repo.mjs';
import { getCurrentUser, filterAccountsForUser } from '@/lib/server/auth.mjs';
import { toJstLabel } from '@/lib/server/schedule.mjs';
import { farmerThreshold } from '@/lib/server/replies.mjs';
import ReplyRow from './ReplyRow';

export const dynamic = 'force-dynamic';

const FILTERS = [
  { key: 'skipped', label: '除外された人', statuses: ['skipped'] },
  { key: 'queued', label: '返信予定', statuses: ['queued'] },
  { key: 'sent', label: '返信済み', statuses: ['sent'] },
  { key: 'new', label: '未判定', statuses: ['new'] },
  { key: 'all', label: 'すべて', statuses: null },
];

export default async function RepliesPage({ searchParams }) {
  const params = await searchParams;

  const user = await getCurrentUser();

  let accounts = [];
  let dbError = null;
  try {
    accounts = filterAccountsForUser(await listAccounts(), user);
  } catch (err) {
    dbError = err.message;
  }

  const selectedId = params?.account ?? accounts[0]?.id ?? null;
  const account = accounts.find((a) => a.id === selectedId) ?? null;
  const filterKey = params?.filter ?? 'skipped';
  const filter = FILTERS.find((f) => f.key === filterKey) ?? FILTERS[0];

  const all = account ? await listRepliesForAccount(account.id) : [];
  const rows = filter.statuses ? all.filter((r) => filter.statuses.includes(r.status)) : all;

  const counts = all.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <div className="page-head">
        <div>
          <h1>リプライ</h1>
          <p className="page-desc">
            自動返信の対象と、除外した相手を確認できます。除外を取り消せば、次の実行で返信されます。
          </p>
          {account && (
            <p className="stat-note" style={{ marginTop: 4 }}>
              被り除外のしきい値: この名義（{account.group ?? 'main'}）は
              <strong> {farmerThreshold(account.group)}名義以上</strong>
              にコメントした人、または通算3投稿以上にコメントした人を外します。
            </p>
          )}
        </div>
      </div>

      {dbError && (
        <div className="notice">
          <strong>Firestore に接続できていません。</strong>
          <div style={{ marginTop: 6 }}>{dbError}</div>
        </div>
      )}

      {account && !account.autoReply && (
        <div className="notice">
          <strong>@{account.name} の自動返信は OFF です。</strong>
          <div style={{ marginTop: 6 }}>
            取得と判定は動きますが、返信は送信されません。有効にするには{' '}
            <code>npm run db:autoreply -- {account.name} on</code>
          </div>
        </div>
      )}

      <div className="filter-row">
        {FILTERS.map((f) => {
          const n = f.statuses
            ? f.statuses.reduce((sum, s) => sum + (counts[s] ?? 0), 0)
            : all.length;
          return (
            <a
              key={f.key}
              className="filter-chip"
              data-active={f.key === filter.key}
              href={`/replies?account=${selectedId ?? ''}&filter=${f.key}`}
            >
              {f.label} {n}
            </a>
          );
        })}
      </div>

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            ✦ {account ? `@${account.name}` : '名義未選択'}
            <small>
              {filter.label} {rows.length}件
            </small>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="empty">
            該当するコメントはありません。
            <br />
            取得するには <code>npm run replies:collect</code>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 130 }}>受信</th>
                <th style={{ width: 160 }}>ユーザー</th>
                <th>コメント</th>
                <th style={{ width: 190 }}>判定</th>
                <th style={{ width: 150 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <ReplyRow key={r.id} reply={r} received={toJstLabel(r.timestamp)} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
