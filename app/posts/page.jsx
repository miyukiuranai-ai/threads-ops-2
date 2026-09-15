import { listAccounts, listPosts } from '@/lib/server/repo.mjs';
import { getCurrentUser, filterAccountsForUser } from '@/lib/server/auth.mjs';
import { toJstLabel } from '@/lib/server/schedule.mjs';
import { LATE_LIMIT_MINUTES, minutesLate } from '@/lib/server/post-time.mjs';
import { AUTO_REVIEW_AT } from '@/lib/server/auto-review.mjs';
import PostRow from './PostRow';

export const dynamic = 'force-dynamic';

/** datetime-local 用に日本時間の "YYYY-MM-DDTHH:MM" を作る。 */
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 9 * 3600000);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 16);
}

const FILTERS = [
  { key: 'queue', label: '承認待ち・保留', statuses: ['pending', 'held', 'draft'] },
  { key: 'approved', label: '承認済み', statuses: ['approved', 'scheduled'] },
  { key: 'missed', label: '時刻切れ', statuses: ['missed'] },
  { key: 'posted', label: '投稿済み', statuses: ['posted', 'failed'] },
  { key: 'rejected', label: '却下', statuses: ['rejected'] },
  { key: 'all', label: 'すべて', statuses: null },
];

export default async function PostsPage({ searchParams }) {
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
  const filterKey = params?.filter ?? 'queue';
  const filter = FILTERS.find((f) => f.key === filterKey) ?? FILTERS[0];

  const all = account ? await listPosts(account.id) : [];
  const posts = filter.statuses ? all.filter((p) => filter.statuses.includes(p.status)) : all;

  const counts = all.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <div className="page-head">
        <div>
          <h1>投稿予定</h1>
          <p className="page-desc">
            承認した投稿だけが予定時刻に自動投稿されます。
            {AUTO_REVIEW_AT} を過ぎても承認待ちのものは、文章だけの投稿を自動で承認し、
            画像が必要な投稿は自動で却下します。
          </p>
        </div>
      </div>

      {dbError && (
        <div className="notice">
          <strong>Firestore に接続できていません。</strong>
          <div style={{ marginTop: 6 }}>{dbError}</div>
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
              href={`/posts?account=${selectedId ?? ''}&filter=${f.key}`}
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
              {filter.label} {posts.length}件
            </small>
          </div>
        </div>

        {posts.length === 0 ? (
          <div className="empty">
            該当する投稿はありません。
            <br />
            生成するには <code>npm run gen -- --account {account?.name ?? '名義'}</code>
          </div>
        ) : (
          <div>
            {posts.map((p) => {
              const label = toJstLabel(p.scheduledAt);
              const [date, time] = label.split(' ');
              return (
                <PostRow
                  key={p.id}
                  post={p}
                  date={date}
                  time={time}
                  scheduledLocal={toLocalInput(p.scheduledAt)}
                  lateMinutes={minutesLate(p.scheduledAt)}
                  lateLimit={LATE_LIMIT_MINUTES}
                />
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
