import Link from 'next/link';
import { pageContext } from '../_lib/session';
import { listPosts, STATUS_JA } from '@/lib/server/posts.mjs';
import { typeName, tierOf } from '@/lib/server/post-types.mjs';
import { VERDICT_JA } from '@/lib/server/impressions.mjs';
import { formatJst, slotLabel, jstDate, addDays } from '@/lib/server/time.mjs';
import { approveAction, rejectAction, holdAction, editAction, deleteThreadAction, removeMediaAction } from '../_actions/posts';
import SubmitButton from '../_components/SubmitButton';
import MediaUploader from '../_components/MediaUploader';
import AccountFilter from '../_components/AccountFilter';

export const dynamic = 'force-dynamic';

const TABS = [
  ['pending', '承認待ち・保留', ['pending', 'held']],
  ['approved', '承認済み', ['approved']],
  ['missed', '時刻切れ', ['missed', 'failed']],
  ['posted', '投稿済み', ['posted', 'deleted']],
  ['rejected', '却下', ['rejected']],
  ['all', 'すべて', null],
];

export default async function PostsPage({ searchParams }) {
  const { session, selected, accountIds, sp } = await pageContext(searchParams);
  const tab = TABS.find((t) => t[0] === sp.tab) || TABS[0];
  const from = tab[0] === 'all' || tab[0] === 'posted' || tab[0] === 'rejected' ? new Date(addDays(jstDate(), -7) + 'T00:00:00+09:00').toISOString() : undefined;
  const posts = await listPosts({ accountIds, statuses: tab[2] || undefined, from, limit: 400, orderBy: ['scheduledAt', tab[0] === 'posted' || tab[0] === 'rejected' ? 'desc' : 'asc'] });
  const q = (t) => `/posts?tab=${t}${selected ? `&account=${selected.id}` : ''}`;
  return (
    <div>
      <h1>投稿予定</h1>
      <AccountFilter selected={selected} base={`/posts?tab=${tab[0]}`} />
      <div className="tabs">{TABS.map((t) => <Link key={t[0]} href={q(t[0])} className={t[0] === tab[0] ? 'active' : ''}>{t[1]}</Link>)}</div>
      <div className="card">
        {!posts.length && <p className="muted">ありません</p>}
        {posts.map((p) => <PostRow key={p.id} p={p} user={session.user} />)}
      </div>
    </div>
  );
}

function PostRow({ p, user }) {
  const editable = ['pending', 'held', 'approved'].includes(p.status);
  return (
    <div className="post">
      <div className="head">
        <b>{slotLabel(p.slot)}</b>
        <span>{p.plannedDate}</span>
        <span>@{p.accountName}</span>
        <span className="badge">{p.slotName}</span>
        <span className={`badge tier-${tierOf(p.type)}`}>{typeName(p.type)}</span>
        <span className={`badge ${p.status === 'posted' ? 'ok' : p.status === 'held' || p.status === 'missed' ? 'warn' : p.status === 'failed' || p.status === 'rejected' ? 'danger' : ''}`}>{STATUS_JA[p.status] || p.status}</span>
        {p.switchedFrom && <span className="badge warn" title={p.switchReason}>切り替え</span>}
        {p.autoApprove && <span className="badge">自動承認</span>}
        {p.dayPattern && <span className="muted">構成: {p.dayPattern}</span>}
        {p.status === 'posted' && (
          <span className="muted">1時間後 {p.snap1h?.views ?? '-'} / 3時間後 {p.snap3h?.views ?? '-'} {p.verdict3h ? <span className={`badge ${p.verdict3h === 'bad' ? 'danger' : p.verdict3h === 'buzz' || p.verdict3h === 'good' ? 'ok' : ''}`}>{VERDICT_JA[p.verdict3h]}</span> : null}</span>
        )}
        {p.postedAt && <span className="muted">投稿 {formatJst(p.postedAt)}</span>}
        {p.permalink && <a href={p.permalink} target="_blank" rel="noreferrer">Threads で見る</a>}
      </div>
      {p.holdReason && <p className="notice">{p.holdReason}</p>}
      {p.rejectedReason && <p className="muted">却下理由: {p.rejectedReason}</p>}
      {editable ? (
        <form action={editAction} className="stack">
          <input type="hidden" name="id" value={p.id} />
          <textarea name="body" className="body" defaultValue={p.body} />
          <div className="row">
            <span style={{ flex: '0 0 120px' }}><label>合言葉</label><input name="keyword" defaultValue={p.keyword || ''} /></span>
            <span style={{ flex: '0 0 110px' }}><label>予定時刻</label><input name="slot" defaultValue={p.slot} placeholder="HH:MM" /></span>
            <span style={{ flex: '0 0 150px' }}><label>日付</label><input name="plannedDate" type="date" defaultValue={p.plannedDate} /></span>
            <span style={{ flex: 1 }}><label>狙い</label><input name="intent" defaultValue={p.intent || ''} /></span>
          </div>
          <label>画像の指示 {p.imageRequired && <span className="badge warn">画像必須</span>} {p.imagePlace && <span className="muted">場所: {p.imagePlace}</span>}</label>
          <input name="imageBrief" defaultValue={p.imageBrief || ''} />
          <div className="actions"><SubmitButton className="ghost small">保存</SubmitButton></div>
        </form>
      ) : (
        <pre className="terminal">{p.body}</pre>
      )}
      <div className="media-list">
        {(p.media || []).map((m) => (
          <span className="m" key={m.fingerprint}>
            {m.kind === 'video' ? '動画' : '画像'} {m.path.split('/').pop().slice(0, 12)}…
            {editable && (
              <form action={removeMediaAction} style={{ display: 'inline' }}>
                <input type="hidden" name="id" value={p.id} /><input type="hidden" name="fingerprint" value={m.fingerprint} />
                <button className="ghost small" type="submit" style={{ marginLeft: 4, padding: '0 4px' }}>×</button>
              </form>
            )}
          </span>
        ))}
        {p.stockId && <span className="m">ストック {p.imageGenre || ''} {p.imageNote || ''}</span>}
      </div>
      {editable && (
        <div className="actions">
          <MediaUploader postId={p.id} accountId={p.accountId} />
          {p.status !== 'approved' && <form action={approveAction}><input type="hidden" name="id" value={p.id} /><SubmitButton className="small">承認</SubmitButton></form>}
          {p.status !== 'held' && <form action={holdAction}><input type="hidden" name="id" value={p.id} /><SubmitButton className="ghost small">保留</SubmitButton></form>}
          <form action={rejectAction}><input type="hidden" name="id" value={p.id} /><SubmitButton className="ghost small">却下</SubmitButton></form>
        </div>
      )}
      {p.status === 'posted' && (
        <div className="actions">
          <form action={deleteThreadAction}><input type="hidden" name="id" value={p.id} /><SubmitButton className="danger small" confirm="Threads から削除します。よろしいですか？">Threads から削除</SubmitButton></form>
        </div>
      )}
      {['missed', 'failed', 'rejected'].includes(p.status) && (
        <div className="actions">
          <form action={approveAction}><input type="hidden" name="id" value={p.id} /><SubmitButton className="ghost small">承認に戻す（時刻を直してから）</SubmitButton></form>
        </div>
      )}
    </div>
  );
}
