'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** /api/* を叩くボタン。長い処理（レポート、指示、作り直し）用 */
export default function ApiButton({ path, body, children, className = 'small', confirm, onDone }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const router = useRouter();
  async function click() {
    if (confirm && !window.confirm(confirm)) return;
    setBusy(true); setMsg('');
    try {
      const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || `失敗 (${res.status})`);
      setMsg('完了');
      router.refresh();
      onDone?.(j);
    } catch (e) { setMsg(`失敗: ${e.message}`); }
    finally { setBusy(false); }
  }
  return (
    <span className="row" style={{ gap: 6, display: 'inline-flex' }}>
      <button type="button" className={className} onClick={click} disabled={busy}>{busy ? '…' : children}</button>
      {msg && <small className={/失敗/.test(msg) ? 'error' : 'ok-text'}>{msg}</small>}
    </span>
  );
}
