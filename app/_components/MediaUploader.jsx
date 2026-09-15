'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { uploadFile } from './upload-client';
import { attachMediaAction } from '../_actions/posts';

export default function MediaUploader({ postId, accountId }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const router = useRouter();
  async function onChange(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setBusy(true); setMsg('');
    try {
      const uploaded = [];
      for (const f of files) uploaded.push(await uploadFile(f, { accountId }));
      await attachMediaAction({ id: postId, files: uploaded });
      setMsg(`${uploaded.length} 件を付けました`);
      router.refresh();
    } catch (err) {
      setMsg(`失敗: ${err.message}`);
    } finally { setBusy(false); e.target.value = ''; }
  }
  return (
    <span className="row" style={{ gap: 6 }}>
      <label className="btn ghost small" style={{ margin: 0, cursor: busy ? 'default' : 'pointer' }}>
        {busy ? 'アップロード中…' : '画像/動画を追加'}
        <input type="file" accept="image/*,video/mp4,video/quicktime" multiple onChange={onChange} disabled={busy} style={{ display: 'none' }} />
      </label>
      {msg && <small className={/失敗/.test(msg) ? 'error' : 'ok-text'}>{msg}</small>}
    </span>
  );
}
