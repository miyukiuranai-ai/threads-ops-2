'use client';

import { useEffect, useRef, useState } from 'react';

/** 日本時間の「月/日 時:分」。 */
function when(iso) {
  const d = new Date(new Date(iso).getTime() + 9 * 3600000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * 相談の画面。会話は全員で共有され、数秒ごとに読み直す。
 * 送ると Claude の返事が付く（数十秒）。
 */
export default function ChatPanel({ initialMessages, userName, modelOptions }) {
  const [messages, setMessages] = useState(initialMessages ?? []);
  const [text, setText] = useState('');
  const [model, setModel] = useState(modelOptions[0]?.key ?? 'claude-opus-5');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const bottom = useRef(null);

  async function refresh() {
    try {
      const res = await fetch('/api/chat', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.messages)) setMessages(data.messages);
    } catch {
      // 読めなかった回は飛ばす
    }
  }

  useEffect(() => {
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    setMessages((m) => [...m, { id: `tmp-${Date.now()}`, role: 'user', name: userName, text: body, createdAt: new Date().toISOString() }]);
    setText('');
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: body, model }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? `失敗しました（${res.status}）`);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function onKey(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="chat">
      <div className="chat-log">
        {messages.length === 0 && (
          <p className="stat-note">
            まだ会話はありません。方針やレポートを踏まえて答えます。「うたは明日1本にして」「星蘭に朝の属人型を1本足して」のように頼むと、その場で反映します。
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className="chat-msg" data-role={m.role}>
            <div className="chat-meta">
              <strong>{m.role === 'assistant' ? 'Claude' : m.role === 'tool' ? '実行' : m.name ?? '運用者'}</strong>
              <span>{when(m.createdAt)}</span>
            </div>
            <div className="chat-text">{m.text}</div>
          </div>
        ))}
        {busy && (
          <div className="chat-msg" data-role="assistant">
            <div className="chat-meta"><strong>Claude</strong><span>考え中…（30秒ほど）</span></div>
          </div>
        )}
        <div ref={bottom} />
      </div>

      <div className="chat-input">
        <textarea
          className="editor"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder="相談を書く。Ctrl+Enter で送信"
          disabled={busy}
        />
        <div className="editor-foot">
          <span>
            <select value={model} onChange={(e) => setModel(e.target.value)} disabled={busy} style={{ width: 'auto', marginRight: 8 }}>
              {modelOptions.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
            <small>1回の返事に数円〜十数円かかります。</small>
            {error && <span className="over" style={{ marginLeft: 8 }}>{error}</span>}
          </span>
          <button type="button" className="btn btn-primary" onClick={send} disabled={busy || !text.trim()} data-pending={busy}>
            {busy ? '送信中…' : '送る'}
          </button>
        </div>
      </div>
    </div>
  );
}
