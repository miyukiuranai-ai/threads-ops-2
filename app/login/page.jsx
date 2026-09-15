import LoginForm from './LoginForm';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'ログイン｜threads-ops2' };

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="brand" style={{ padding: 0, marginBottom: 18 }}>
          <div className="brand-mark">T</div>
          <div>
            <div className="brand-title" style={{ color: 'var(--ink)' }}>
              threads-ops2
            </div>
            <div className="stat-note">管理画面（検証環境）</div>
          </div>
        </div>

        <LoginForm next={params?.next ?? ''} />

        <p className="stat-note" style={{ marginBottom: 0 }}>
          IDとパスワードは管理者から受け取ってください。
        </p>
      </div>
    </div>
  );
}
