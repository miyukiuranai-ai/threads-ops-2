import LoginForm from './LoginForm';

export default async function LoginPage({ searchParams }) {
  const sp = (await searchParams) || {};
  return (
    <div className="card">
      <h1>threads-ops2</h1>
      <p className="muted">検証環境です。本家とはデータも定期実行も共有しません。</p>
      <LoginForm next={typeof sp.next === 'string' ? sp.next : '/'} />
    </div>
  );
}
