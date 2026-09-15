import Link from 'next/link';
import { logoutAction } from '../_actions/auth';

const PAGES = [
  ['/', '全体状況'],
  ['/posts', '投稿予定'],
  ['/replies', 'リプライ'],
  ['/personas', 'キャラ設定'],
  ['/research', 'リサーチ'],
  ['/stock', '画像ストック'],
  ['/settings', '設定'],
  ['/chat', '相談'],
];

export default function Sidebar({ session, accounts }) {
  const groups = {};
  for (const a of accounts) (groups[a.group || 'main'] ||= []).push(a);
  return (
    <aside className="sidebar">
      <div className="brand">threads-ops2<small>Threads 自動運用</small></div>
      {Object.entries(groups).map(([g, list]) => (
        <div key={g}>
          <div className="group-title">{g}</div>
          <div className="chips">
            {list.map((a) => (
              <Link key={a.id} href={`?account=${encodeURIComponent(a.id)}`} className={`chip ${a.status !== 'active' ? 'paused' : ''}`} title={a.status}>@{a.name}</Link>
            ))}
          </div>
        </div>
      ))}
      {!accounts.length && <div className="group-title">名義がありません（設定で追加）</div>}
      <div className="group-title">ページ</div>
      <nav>
        {PAGES.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
      </nav>
      <div className="foot">
        {session.user}（{session.role === 'admin' ? '管理者' : session.group}）
        <form action={logoutAction}><button className="ghost small" type="submit" style={{ marginLeft: 8 }}>ログアウト</button></form>
      </div>
    </aside>
  );
}
