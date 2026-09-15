import './globals.css';
import { headers } from 'next/headers';
import Sidebar from './_components/Sidebar';
import { listAccounts } from '@/lib/server/repo.mjs';
import { getCurrentUser, filterAccountsForUser, groupAccounts } from '@/lib/server/auth.mjs';

export const metadata = {
  title: 'threads-ops2',
  description: '公式Threads APIのみで複数名義を運用する管理画面',
};

export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }) {
  // ログイン画面だけはサイドバーを出さない
  const pathname = (await headers()).get('x-pathname') ?? '';
  if (pathname === '/login') {
    return (
      <html lang="ja">
        <body>{children}</body>
      </html>
    );
  }

  // Firestore 未設定でも画面自体は開けるようにする（設定画面で案内を出す）
  const user = await getCurrentUser();

  let accounts = [];
  let groups = [];
  let dbError = null;
  try {
    accounts = filterAccountsForUser(await listAccounts(), user);
    groups = groupAccounts(accounts);
  } catch (err) {
    dbError = err.message;
  }

  return (
    <html lang="ja">
      <body>
        <div className="shell">
          <Sidebar accounts={accounts} groups={groups} dbError={dbError} user={user} />
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
