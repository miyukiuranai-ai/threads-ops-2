'use client';

import { useState } from 'react';
import { requestUpload, attachMedia, removeMedia } from '../_actions/media';
import SubmitButton from '../_components/SubmitButton';

const ACCEPT = 'image/jpeg,image/png,video/mp4,video/quicktime';

/** 先頭4MBの指紋。使い回しの判定に使う（全体を読むと動画で重くなるため）。 */
async function fingerprintOf(file) {
  const head = await file.slice(0, 4 * 1024 * 1024).arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', head);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex}-${file.size}`;
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;

/**
 * 画像・動画の添付。
 * Vercel は4.5MBを超えるリクエストを通せないので、
 * ファイル本体はブラウザから直接 Firebase Storage へ送る。
 */
export default function MediaField({ post }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const media = Array.isArray(post.media) ? post.media : [];

  async function onPick(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setError(null);
    try {
      setBusy('確認中…');
      const fingerprint = await fingerprintOf(file);

      const ask = new FormData();
      ask.set('postId', post.id);
      ask.set('fingerprint', fingerprint);
      ask.set('contentType', file.type);
      ask.set('bytes', String(file.size));
      const plan = await requestUpload(ask);
      if (plan.error) throw new Error(plan.error);

      setBusy(`送信中… 0%`);
      await put(plan.uploadUrl, file, (pct) => setBusy(`送信中… ${pct}%`));

      setBusy('登録中…');
      const done = new FormData();
      done.set('postId', post.id);
      done.set('fingerprint', fingerprint);
      done.set('path', plan.path);
      done.set('kind', plan.kind);
      done.set('contentType', file.type);
      done.set('bytes', String(file.size));
      const saved = await attachMedia(done);
      if (saved.error) throw new Error(saved.error);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="media-field">
      {media.length > 0 && (
        <ul className="media-list">
          {media.map((m) => (
            <li key={m.fingerprint ?? m.path}>
              <span className="badge" data-tone="ok">
                {m.kind === 'video' ? '動画' : '画像'}
              </span>
              <span className="media-name">{m.path?.split('/').pop()}</span>
              <span className="media-size">{mb(m.bytes ?? 0)}</span>
              <form action={removeMedia}>
                <input type="hidden" name="postId" value={post.id} />
                <input type="hidden" name="fingerprint" value={m.fingerprint ?? ''} />
                <SubmitButton className="btn" pendingLabel="…">
                  外す
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      )}

      <label className="media-pick">
        <input type="file" accept={ACCEPT} onChange={onPick} disabled={Boolean(busy)} />
        <span className="btn" data-pending={Boolean(busy)}>
          {busy ?? (media.length ? 'さらに追加' : '画像・動画を追加')}
        </span>
      </label>

      <div className="media-note">
        画像 JPEG/PNG・8MBまで／動画 MP4/MOV・1GB・5分まで。2つ以上入れると複数枚の投稿になります（20個まで）。
      </div>

      {error && <div className="media-note over">{error}</div>}
    </div>
  );
}

/** 進み具合を出したいので fetch ではなく XHR を使う。 */
function put(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`アップロードに失敗しました（${xhr.status}）。`));
    xhr.onerror = () => reject(new Error('アップロードに失敗しました。通信を確認してください。'));
    xhr.send(file);
  });
}
