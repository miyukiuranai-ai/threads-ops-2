'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** 明日の日付（日本時間）。返事は次に作るぶん＝明日の投稿に効く。 */
function tomorrow() {
  return new Date(Date.now() + 9 * 3600000 + 86400000).toISOString().slice(0, 10);
}

const ACTIONS = [
  { key: 'rest', label: '休む' },
  { key: 'one', label: '1本' },
  { key: 'one_buzz', label: '1本バズ' },
  { key: 'two', label: '2本' },
  { key: 'keep', label: 'そのまま' },
];

/**
 * レポートの提案への返事ボタン。
 * 押すと、その名義の明日ぶんの下書きを指示どおりに作り直す（30〜60秒）。
 */
export default function AlertActions({ accountId, accountName, current = null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);

  async function send(action) {
    setBusy(action);
    setMessage(null);
    try {
      const res = await fetch('/api/directive', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountId, action, date: tomorrow() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? `失敗しました（${res.status}）`);
      setMessage(
        `${data.date} は「${data.action}」で作り直しました（${data.count}本${data.rejected ? `、前の${data.rejected}本は却下` : ''}）。${data.note ?? ''}`
      );
      router.refresh();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 4 }}>
      <span className="post-slot" style={{ fontSize: 12 }}>返事（明日の @{accountName}）:</span>
      {ACTIONS.map((a) => (
        <button
          key={a.key}
          type="button"
          className="btn"
          style={{ padding: '2px 10px', fontSize: 12, fontWeight: current === a.key ? 700 : 400 }}
          disabled={busy !== null}
          data-pending={busy === a.key}
          onClick={() => send(a.key)}
        >
          {busy === a.key ? '作成中…' : a.label}
        </button>
      ))}
      {current && !message && <span className="post-slot" style={{ fontSize: 12 }}>（いまの返事: {ACTIONS.find((a) => a.key === current)?.label}）</span>}
      {message && <span className={/失敗|エラー|ません/.test(message) ? 'over' : ''} style={{ fontSize: 12 }}>{message}</span>}
    </div>
  );
}
