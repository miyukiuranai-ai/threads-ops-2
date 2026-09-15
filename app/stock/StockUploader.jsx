'use client';

import { useEffect, useState } from 'react';
import { requestStockUpload, saveStockItem } from '../_actions/stock';
import { looksPlaceSpecific } from '@/lib/shared/place-words.mjs';

const ACCEPT = ['image/jpeg', 'image/png'];
const STOCK_LABEL = { single: '1枚', pair: '2枚（くっつけ）' };

/** 先頭4MBの指紋（投稿の添付と同じ）。 */
async function fingerprintOf(file) {
  const head = await file.slice(0, 4 * 1024 * 1024).arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', head);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex}-${file.size}`;
}

/** 1枚の画像を左右半分に割って、2つのファイルにする（くっつけ用）。 */
async function splitLeftRight(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('画像を読み込めませんでした。'));
      i.src = url;
    });
    const half = Math.floor(img.naturalWidth / 2);
    const h = img.naturalHeight;
    const make = (sx, w, name) =>
      new Promise((resolve, reject) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d').drawImage(img, sx, 0, w, h, 0, 0, w, h);
        c.toBlob((blob) => (blob ? resolve(new File([blob], name, { type: 'image/jpeg' })) : reject(new Error('画像を分割できませんでした。'))), 'image/jpeg', 0.92);
      });
    const base = file.name.replace(/\.[^.]+$/, '');
    const left = await make(0, half, `${base}_left.jpg`);
    const right = await make(half, img.naturalWidth - half, `${base}_right.jpg`);
    return [left, right];
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 選んだ画像の小さな見本。ブラウザの中だけで出す（まだ送っていない） */
function BatchThumb({ file }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!file) return undefined;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url ? <img src={url} alt="" className="stock-batch-thumb" /> : <div className="stock-batch-thumb" />;
}

function put(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`アップロードに失敗しました（${xhr.status}）。`)));
    xhr.onerror = () => reject(new Error('アップロードに失敗しました。通信を確認してください。'));
    xhr.send(file);
  });
}

/**
 * 画像ストックの登録。
 * 1枚（single）か、左右2枚の組（pair＝くっつけ）を、系統（ジャンル）を付けて貯める。
 */
export default function StockUploader({ accounts, genres }) {
  const [kind, setKind] = useState('single');
  const [genre, setGenre] = useState('');
  const [note, setNote] = useState('');
  const [accountId, setAccountId] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  // 場所が分かる画像か。null なら系統の語から推し量る（鳥居、富士山など）。人が触ればその値を使う
  const [placeChoice, setPlaceChoice] = useState(null);
  const [dragging, setDragging] = useState(false);

  // 2枚の型で「すでに左右に割ってある2枚を1組として入れる」とき true。false なら1枚ずつ左右に割る
  const [preSplit, setPreSplit] = useState(false);
  // 件ごとの説明（画像の中身、場所など）。空ならまとめてのメモを使う
  const [itemNotes, setItemNotes] = useState({});

  const placeSpecific = placeChoice ?? looksPlaceSpecific(genre, note);
  // 同じ系統ならまとめて入れられる。1枚の型は1ファイル=1件、2枚の型は1ファイルを割って1件（割ってある2枚なら2ファイルで1件）
  const groups = kind === 'pair' && preSplit ? Math.floor(files.length / 2) : files.length;

  /** 選ばれた（または落とされた）ファイルを受け取る。JPEG/PNG 以外は捨てる。何枚でもよい */
  function takeFiles(list) {
    const ok = [...(list ?? [])].filter((f) => ACCEPT.includes(f.type));
    if (!ok.length) return setMessage('画像は JPEG か PNG にしてください。');
    setMessage(null);
    setFiles(ok);
    setItemNotes({});
  }

  /** i 件目に入る画像（表示とメモ用）。割ってある2枚を組にするときは2ファイルで1件 */
  function filesOfGroup(i) {
    return kind === 'pair' && preSplit ? files.slice(i * 2, i * 2 + 2) : [files[i]];
  }

  /** 1件ぶん（1枚、または左右2枚）を送って登録する */
  async function uploadOne(list, label, itemNote) {
    const uploaded = [];
    for (const [i, file] of list.entries()) {
      const fingerprint = await fingerprintOf(file);
      const ask = new FormData();
      ask.set('fingerprint', fingerprint);
      ask.set('contentType', file.type);
      ask.set('bytes', String(file.size));
      const plan = await requestStockUpload(ask);
      if (plan.error) throw new Error(plan.error);
      await put(plan.uploadUrl, file, (pct) => setBusy(`${label} 送信中… ${pct}%`));
      uploaded.push({ fingerprint, path: plan.path, contentType: file.type, bytes: file.size });
    }
    setBusy(`${label} 登録中…`);
    const done = new FormData();
    done.set('kind', kind);
    done.set('genre', genre.trim());
    done.set('note', String(itemNote ?? '').trim() || note);
    done.set('accountId', accountId);
    done.set('placeSpecific', placeSpecific ? '1' : '0');
    done.set('files', JSON.stringify(uploaded));
    const saved = await saveStockItem(done);
    if (saved.error) throw new Error(saved.error);
  }

  async function submit() {
    setMessage(null);
    if (!genre.trim()) return setMessage('系統（ジャンル）を入れてください。');
    if (!files.length) return setMessage('画像を選んでください。');
    if (kind === 'pair' && preSplit && files.length % 2 !== 0) return setMessage('割ってある2枚を組にするので、枚数は偶数にしてください（左・右の順）。');
    setBusy('確認中…');
    let doneCount = 0;
    try {
      // 1件ずつ順に送る。途中で失敗したら、そこまでの件数を残して止める
      if (kind === 'pair' && preSplit) {
        for (let i = 0; i < files.length; i += 2) {
          await uploadOne([files[i], files[i + 1]], `${i / 2 + 1}/${groups}件目`, itemNotes[i / 2]);
          doneCount += 1;
        }
      } else if (kind === 'pair') {
        for (const [i, file] of files.entries()) {
          setBusy(`${i + 1}/${groups}件目 左右に割っています…`);
          const halves = await splitLeftRight(file);
          await uploadOne(halves, `${i + 1}/${groups}件目`, itemNotes[i]);
          doneCount += 1;
        }
      } else {
        for (const [i, file] of files.entries()) {
          await uploadOne([file], `${i + 1}/${groups}件目`, itemNotes[i]);
          doneCount += 1;
        }
      }
      setMessage(`「${genre.trim()}」に${STOCK_LABEL[kind]}を${doneCount}件登録しました。`);
      setFiles([]);
      setItemNotes({});
      setNote('');
    } catch (err) {
      setMessage(`${doneCount}件登録したところで止まりました: ${err.message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="field-grid">
        <label className="field">
          <span>種類</span>
          <select value={kind} onChange={(e) => { setKind(e.target.value); setFiles([]); }} disabled={Boolean(busy)}>
            <option value="single">1枚（「いいねと🍀で運氣が上がります」型）</option>
            <option value="pair">2枚（「2本の指でくっつけてみて」型。左・右の順）</option>
          </select>
        </label>
        <label className="field">
          <span>系統（ジャンル）</span>
          <input list="stock-genres" value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="例: 朝日、龍、鳥居、海、花" disabled={Boolean(busy)} />
          <datalist id="stock-genres">
            {genres.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
          <small>同じ語でそろえると、生成のときに系統で選べます。</small>
        </label>
        <label className="field">
          <span>使う名義</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={Boolean(busy)}>
            <option value="">全名義で使う</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>@{a.name} だけ</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>まとめてのメモ（任意）</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例: 貴船の朝。縦構図" disabled={Boolean(busy)} />
          <small>件ごとの説明を書かなかった画像には、このメモが入ります。</small>
        </label>
      </div>

      <label className="field" style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={placeSpecific} onChange={(e) => setPlaceChoice(e.target.checked)} disabled={Boolean(busy)} />
        <span>場所が分かる画像（鳥居、富士山、寺社など）。超バズ特化型だけに自動で使います。系統か説明に「大阪府 住吉大社」のように土地の名前を入れておくと、土地移動型の案内に「ストックにあります」と出ます</span>
      </label>

      <label
        className={`field stock-drop${dragging ? ' is-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy) takeFiles(e.dataTransfer?.files);
        }}
      >
        <span>画像（JPEG / PNG、1枚 8MBまで。同じ系統なら何枚でもまとめて）— ここにドラッグして落とすか、選ぶ</span>
        <input
          type="file"
          accept="image/jpeg,image/png"
          multiple
          key={kind}
          onChange={(e) => takeFiles(e.target.files)}
          disabled={Boolean(busy)}
        />
        <small>
          {kind === 'pair'
            ? '割る前の画像を何枚でも。1枚ずつツールが左右半分に割って、1枚＝1件で登録します。投稿では2枚並びになり、指でくっつけると1枚に見えます。'
            : '龍雲や朝日のような、1枚で成立する画像。1枚＝1件で登録します。'}
          {files.length > 0 && ` 選択中: ${files.length}枚 → ${groups}件`}
        </small>
      </label>

      {groups > 0 && (
        <div className="stock-batch">
          {Array.from({ length: groups }, (_, i) => {
            const fs = filesOfGroup(i);
            return (
              <div className="stock-batch-row" key={`${i}-${fs.map((f) => f.name).join('|')}`}>
                <BatchThumb file={fs[0]} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="stock-batch-name">{fs.map((f) => f.name).join(' ＋ ')}</div>
                  <input
                    value={itemNotes[i] ?? ''}
                    onChange={(e) => setItemNotes({ ...itemNotes, [i]: e.target.value })}
                    placeholder="この画像の説明（例: 京都府 貴船神社の灯籠の石段。夕方）"
                    disabled={Boolean(busy)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {kind === 'pair' && (
        <label className="field" style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={preSplit} onChange={(e) => setPreSplit(e.target.checked)} disabled={Boolean(busy)} />
          <span>すでに左右に割ってある画像を入れる（左・右の順で2枚ずつ1組にする）</span>
        </label>
      )}

      <div className="editor-foot">
        <span>{message && <span className={/失敗|ください|不正/.test(message) ? 'over' : ''}>{message}</span>}</span>
        <button
          type="button"
          className="btn btn-primary"
          onClick={submit}
          disabled={Boolean(busy) || groups === 0}
          data-pending={Boolean(busy)}
        >
          {busy ?? (groups > 1 ? `${groups}件をストックに登録` : 'ストックに登録')}
        </button>
      </div>
    </div>
  );
}
