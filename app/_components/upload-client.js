'use client';
// ブラウザ側: 指紋（sha256 先頭 4MB - サイズ）を作り、署名付き URL で直接 PUT する。

export async function fingerprintFile(file) {
  const head = await file.slice(0, 4 * 1024 * 1024).arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', head);
  const hex = Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex}-${file.size}`;
}

export async function uploadFile(file, { accountId } = {}) {
  const fingerprint = await fingerprintFile(file);
  const contentType = file.type || 'application/octet-stream';
  const res = await fetch('/api/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fingerprint, contentType, bytes: file.size, accountId }) });
  const j = await res.json();
  if (!res.ok || !j.ok) throw new Error(j.error || 'URL の取得に失敗');
  if (!j.exists) {
    const put = await fetch(j.url, { method: 'PUT', headers: { 'content-type': contentType }, body: file });
    if (!put.ok) throw new Error(`アップロードに失敗 (${put.status})`);
  }
  return { fingerprint, path: j.path, kind: j.kind, contentType: j.contentType, bytes: file.size, name: file.name };
}

/** 画像を左右半分に割って 2 枚にする（pair の登録用） */
export async function splitImageLeftRight(file) {
  const bmp = await createImageBitmap(file);
  const w = Math.floor(bmp.width / 2), h = bmp.height;
  const out = [];
  for (let i = 0; i < 2; i++) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(bmp, i * w, 0, w, h, 0, 0, w, h);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
    out.push(new File([blob], file.name.replace(/\.[^.]+$/, '') + (i === 0 ? '_L.jpg' : '_R.jpg'), { type: 'image/jpeg' }));
  }
  return out;
}
