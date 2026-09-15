'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ChatBox() {
  const [text, setText] = useState('');
  const [model, setModel] = useState('claude-opus-5');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const router = useRouter();
  async function send() {
    if (!text.trim()) return;
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, model }) });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || `失敗 (${res.status})`);
      setText('');
      router.refresh();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }
  return (
    <div className="card">
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="相談を書く（例: 星蘭の明日は2本にして、1本目はバズにして）" disabled={busy} />
      <div className="row" style={{ marginTop: 8 }}>
        <select value={model} onChange={(e) => setModel(e.target.value)} style={{ width: 180 }}><option value="claude-opus-5">claude-opus-5</option><option value="claude-sonnet-5">claude-sonnet-5</option></select>
        <button type="button" onClick={send} disabled={busy}>{busy ? '考え中…' : '送る'}</button>
        {err && <span className="error">{err}</span>}
      </div>
    </div>
  );
}
