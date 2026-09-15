import Link from 'next/link';
import { pageContext } from './_lib/session';
import { countByStatus } from '@/lib/server/posts.mjs';
import { countNewReplies } from '@/lib/server/replies.mjs';
import { tokenDaysLeft } from '@/lib/server/accounts.mjs';
import { recentErrors } from '@/lib/server/runs.mjs';
import { balanceStatus } from '@/lib/server/settings.mjs';
import { modeLabel } from '@/lib/server/guard.mjs';
import { formatJst } from '@/lib/server/time.mjs';

export const dynamic = 'force-dynamic';

export default async function Dashboard({ searchParams }) {
  const { session, accounts, selected, accountIds } = await pageContext(searchParams);
  const list = selected ? [selected] : accounts;
  const [counts, newReplies, errors, balance] = await Promise.all([
    countByStatus(accountIds).catch(() => ({})),
    countNewReplies(accountIds).catch(() => ({})),
    recentErrors({ limit: 8 }).catch(() => []),
    session.role === 'admin' ? balanceStatus().catch(() => null) : Promise.resolve(null),
  ]);
  const modes = modeLabel();
  return (
    <div>
      <h1>全体状況</h1>
      <p className="muted">投稿 <span className={`badge ${modes.posting === 'live' ? 'ok' : 'warn'}`}>{modes.posting}</span> 返信 <span className={`badge ${modes.reply === 'live' ? 'ok' : 'warn'}`}>{modes.reply}</span> {selected && <> / 名義 @{selected.name} で絞り込み <Link href="/">解除</Link></>}</p>
      {balance && balance.level !== 'ok' && (
        <div className={`alert ${balance.level === 'danger' ? 'danger' : ''}`}>Anthropic の残高: {balance.message}（<Link href="/settings">設定で入力</Link>）</div>
      )}
      <div className="grid">
        {await Promise.all(list.map(async (a) => {
          const c = counts[a.id] || {};
          const days = await tokenDaysLeft(a);
          return (
            <div className="card" key={a.id}>
              <div className="row spread"><b>@{a.name}</b> <span className={`badge ${a.status === 'active' ? 'ok' : 'warn'}`}>{a.status}</span></div>
              <div className="row" style={{ marginTop: 8 }}>
                <span className="stat">{c.pending || 0}<small>承認待ち</small></span>
                <span className="stat">{c.approved || 0}<small>承認済み</small></span>
                <span className="stat">{c.posted || 0}<small>投稿済み</small></span>
                <span className="stat">{c.rejected || 0}<small>却下</small></span>
              </div>
              <p className="muted">保留 {c.held || 0} / 時刻切れ {c.missed || 0} / 失敗 {c.failed || 0} / 未処理コメント {newReplies[a.id] || 0}</p>
              <p className="muted">トークン: {days == null ? '未登録' : <span className={`badge ${days <= 3 ? 'danger' : days <= 10 ? 'warn' : 'ok'}`}>残り {days} 日</span>} {a.autoReply && <span className="badge">自動返信</span>} {a.manualOnly && <span className="badge">手動承認のみ</span>}</p>
              <p><Link href={`/posts?account=${a.id}`}>投稿予定</Link> / <Link href={`/replies?account=${a.id}`}>リプライ</Link> / <Link href={`/personas?account=${a.id}`}>キャラ設定</Link></p>
            </div>
          );
        }))}
      </div>
      {!accounts.length && <div className="card">名義がありません。<Link href="/settings">設定</Link>から追加してください。</div>}
      <h2>直近のエラー</h2>
      <div className="card">
        {!errors.length && <p className="muted">ありません</p>}
        {errors.map((r) => (
          <details key={r.id}>
            <summary>{formatJst(r.startedAt)} {r.job} {r.error ? <span className="error">{r.error.slice(0, 120)}</span> : <span className="muted">名義単位のエラーあり</span>}</summary>
            <pre className="terminal">{JSON.stringify((r.results || []).filter((x) => x && (x.error || (x.results || []).some?.((y) => y?.error))), null, 1).slice(0, 4000)}</pre>
          </details>
        ))}
      </div>
    </div>
  );
}
