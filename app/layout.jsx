import './globals.css';
import Sidebar from './_components/Sidebar';
import { getSession } from './_lib/session';
import { listAccountsForSession } from '@/lib/server/accounts.mjs';

export const metadata = { title: 'threads-ops2', description: 'Threads 自動運用ツール' };
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }) {
  const session = await getSession();
  let accounts = [];
  if (session) { try { accounts = await listAccountsForSession(session); } catch { accounts = []; } }
  return (
    <html lang="ja">
      <body>
        {session ? (
          <div className="shell">
            <Sidebar session={session} accounts={accounts} />
            <main className="main">{children}</main>
          </div>
        ) : (
          <main className="main main-bare">{children}</main>
        )}
      </body>
    </html>
  );
}
