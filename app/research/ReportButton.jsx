'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** 昨日の日付（日本時間）。反応は翌日に集計されるので、作れるのは昨日まで。 */
function yesterday() {
  return new Date(Date.now() + 9 * 3600000 - 86400000).toISOString().slice(0, 10);
}

/**
 * 日次レポートを画面から作り直す。
 * 毎日 15:30 に自動で作られるが、見たいときに待たずに出せるようにする。
 * 同じ日付のレポートは上書きされる。
 */
export default function ReportButton() {
  const router = useRouter();
  const [date, setDate] = useState(yesterday());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  async function run() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? `失敗しました（${res.status}）`);
      setMessage(data.skipped ? `${data.date}: ${data.skipped}` : `${data.date} のレポートを作り直しました。`);
      router.refresh();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="schedule-form" style={{ marginTop: 0 }}>
      <label>
        対象日
        <input
          type="date"
          value={date}
          max={yesterday()}
          onChange={(e) => setDate(e.target.value)}
          disabled={busy}
        />
      </label>
      <button type="button" className="btn" onClick={run} disabled={busy} data-pending={busy}>
        {busy ? '作成中…（30秒ほど）' : 'いま作り直す'}
      </button>
      {message && <span className={/失敗|エラー|ください/.test(message) ? 'over' : ''}>{message}</span>}
    </div>
  );
}
