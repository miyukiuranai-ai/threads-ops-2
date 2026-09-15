import { getCurrentUser } from '@/lib/server/auth.mjs';
import { loadMessages } from '@/lib/server/chat.mjs';
import { MODELS } from '@/lib/server/claude.mjs';
import ChatPanel from './ChatPanel';

export const dynamic = 'force-dynamic';

/**
 * 相談のページ。
 * 方針（CLAUDE.md と docs/claude-memory）と、いまのレポート・名義の設定を踏まえて Claude が答える。
 * 会話は全員で共有される。設定の変更はここからはできない。
 */
export default async function ChatPage() {
  const user = await getCurrentUser();
  let messages = [];
  let dbError = null;
  try {
    messages = await loadMessages({ limit: 80 });
  } catch (err) {
    dbError = err.message;
  }

  const modelOptions = Object.entries(MODELS).map(([key, m]) => ({ key, label: m.label ?? key }));

  return (
    <>
      <section className="card">
        <div className="card-head">
          <div className="card-title">
            ✦ 相談 <small>全員で同じ会話を共有します</small>
          </div>
        </div>
        <p className="stat-note" style={{ marginTop: 0 }}>
          運用の方針、最新のレポート、名義の設定、監視リストを踏まえて答えます。
          ここからは設定を変えられないので、決まったことはキャラ設定やレポートの返事ボタンで反映してください。
        </p>
        {dbError && <p className="over">{dbError}</p>}
        <ChatPanel initialMessages={messages} userName={user?.name ?? '運用者'} modelOptions={modelOptions} />
      </section>
    </>
  );
}
