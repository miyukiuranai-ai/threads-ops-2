'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { uploadFile, splitImageLeftRight } from '../_components/upload-client';
import { addStockItemsAction } from '../_actions/stock';

export default function StockUploader({ accounts }) {
  const [items, setItems] = useState([]);
  const [kind, setKind] = useState('single');
  const [genre, setGenre] = useState('');
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const router = useRouter();

  function addFiles(files) {
    const list = Array.from(files || []).filter((f) => f.type.startsWith('image/'));
    setItems((cur) => [...cur, ...list.map((f) => ({ file: f, note: '', url: URL.createObjectURL(f) }))]);
  }
  async function submit() {
    if (!items.length) return;
    setBusy(true); setMsg('');
    try {
      const payload = [];
      for (const it of items) {
        const files = kind === 'pair' ? await splitImageLeftRight(it.file) : [it.file];
        const uploaded = [];
        for (const f of files) uploaded.push(await uploadFile(f, { accountId: 'stock' }));
        payload.push({ kind, genre: genre || '未分類', note: it.note, accountId: accountId || null, files: uploaded.map(({ fingerprint, path, contentType, bytes }) => ({ fingerprint, path, contentType, bytes })) });
      }
      await addStockItemsAction(payload);
      setMsg(`${payload.length} 件を登録しました`);
      setItems([]);
      router.refresh();
    } catch (e) { setMsg(`失敗: ${e.message}`); }
    finally { setBusy(false); }
  }
  return (
    <div className="card" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
      <div className="row">
        <span><label>種類</label><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="single">1枚</option><option value="pair">2枚（1枚を左右半分に割って登録）</option></select></span>
        <span><label>系統（漢字、鳥居、月、花、開運、龍 など）</label><input value={genre} onChange={(e) => setGenre(e.target.value)} /></span>
        <span><label>名義</label><select value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">全名義</option>{accounts.map((a) => <option key={a.id} value={a.id}>@{a.name}</option>)}</select></span>
        <span><label>画像（何枚でも。ここにドラッグで落とせる）</label><input type="file" accept="image/*" multiple onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} /></span>
      </div>
      {items.length > 0 && (
        <table style={{ marginTop: 10 }}>
          <tbody>{items.map((it, i) => (
            <tr key={i}>
              <td style={{ width: 80 }}><img src={it.url} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 4 }} /></td>
              <td className="muted">{it.file.name}</td>
              <td><input value={it.note} placeholder="説明（漢字なら字そのもの: 福、縁…）" onChange={(e) => setItems((cur) => cur.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} /></td>
              <td><button type="button" className="ghost small" onClick={() => setItems((cur) => cur.filter((_, j) => j !== i))}>外す</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <div className="row" style={{ marginTop: 10 }}>
        <button type="button" onClick={submit} disabled={busy || !items.length}>{busy ? 'アップロード中…' : `${items.length} 件を登録`}</button>
        {msg && <span className={/失敗/.test(msg) ? 'error' : 'ok-text'}>{msg}</span>}
      </div>
    </div>
  );
}
