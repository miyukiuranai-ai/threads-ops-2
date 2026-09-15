'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { logout } from '../_actions/auth';
import SubmitButton from './SubmitButton';

const NAV = [
  { href: '/', label: '全体状況' },
  { href: '/posts', label: '投稿予定' },
  { href: '/replies', label: 'リプライ' },
  { href: '/personas', label: 'キャラ設定' },
  { href: '/research', label: 'リサーチ' },
  { href: '/stock', label: '画像ストック' },
  { href: '/chat', label: '相談' },
  { href: '/settings', label: '設定' },
];

export default function Sidebar({ accounts, groups = [], dbError, user }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selected = searchParams.get('account') ?? accounts[0]?.id ?? null;

  // 名義の選択はクエリで持ち回す
  const withAccount = (href) => (selected ? `${href}?account=${selected}` : href);
  const current = accounts.find((a) => a.id === selected);

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">T</div>
        <div>
          <div className="brand-title">threads-ops2</div>
          <div className="brand-sub">{current ? `@${current.name}` : '名義未登録'}</div>
        </div>
      </div>

      <div className="account-switch">
        {accounts.length === 0 && <div className="brand-sub">アカウント未連携</div>}

        {/* 担当者が複数いるときだけ、誰の名義かを見出しで分ける */}
        {groups.map((g) => (
          <div key={g.group} className="account-group">
            {groups.length > 1 && <div className="account-group-label">{g.label}</div>}
            <div className="account-group-chips">
              {g.accounts.map((a) => (
                <Link
                  key={a.id}
                  className="account-chip"
                  data-active={a.id === selected}
                  href={`${pathname}?account=${a.id}`}
                >
                  @{a.name}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      <nav className="nav">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={withAccount(item.href)}
            data-active={
              item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
            }
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="sidebar-foot">
        <div className="brand-sub" style={{ marginBottom: 6 }}>
          投稿ガード
        </div>
        <div className="guard">
          <span className="dot" data-state={dbError ? 'stopped' : 'ok'} />
          {dbError ? 'DB未接続' : '投稿可能'}
        </div>

        {user && (
          <div className="sidebar-user">
            <div>
              <div className="sidebar-user-name">{user.name}</div>
              <div className="brand-sub">
                {user.role === 'admin' ? '管理者' : `メンバー・${user.group ?? '-'}`}
              </div>
            </div>
            <form action={logout}>
              <SubmitButton className="btn btn-logout" pendingLabel="…">
                ログアウト
              </SubmitButton>
            </form>
          </div>
        )}
      </div>
    </aside>
  );
}
