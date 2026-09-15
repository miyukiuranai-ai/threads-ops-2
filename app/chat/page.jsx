import { pageContext } from '../_lib/session';
import { listMessages } from '@/lib/server/chat.mjs';
import { formatJst } from '@/lib/server/time.mjs';
import ChatBox from './ChatBox';

export const dynamic = 'force-dynamic';

export default async function ChatPage({ searchParams }) {
  await pageContext(searchParams);
  const messages = await listMessages({ limit: 80 });
  return (
    <div>
      <h1>相談</h1>
      <p className="muted">全員で共有する会話。Claude が方針（CLAUDE.md と判断メモ）・最新レポート・名義設定・監視リスト・今日の暦を踏まえて答えます。道具: list_drafts / set_day_directive / generate_posts / edit_draft / delete_post / update_persona / set_impression_lines。1回ごとに API の費用がかかります。</p>
      <div className="card chat">
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            <div className="who">{m.role === 'tool' ? '実行' : m.name || m.role} · {formatJst(m.createdAt)}{m.usage?.usd ? ` · $${m.usage.usd.toFixed(3)}` : ''}</div>
            {m.text}
          </div>
        ))}
        {!messages.length && <p className="muted">まだ会話がありません。</p>}
      </div>
      <ChatBox />
    </div>
  );
}
