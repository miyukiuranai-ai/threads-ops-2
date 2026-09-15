'use client';

import { useActionState } from 'react';
import { updateStockItem } from '../_actions/stock';
import SubmitButton from '../_components/SubmitButton';

const initial = { ok: null, error: null };

/** ストック1件の編集（系統・メモ・使う名義）。画像そのものは変えない。 */
export default function StockEditForm({ item, accounts }) {
  const [state, action] = useActionState(async (_prev, formData) => updateStockItem(formData), initial);

  return (
    <details className="stock-edit">
      <summary>編集</summary>
      <form action={action} style={{ display: 'grid', gap: 6, marginTop: 6 }}>
        <input type="hidden" name="id" value={item.id} />
        <input name="genre" defaultValue={item.genre ?? ''} placeholder="系統（例: 龍、鳥居、漢字）" list="stock-genres" required />
        <input name="note" defaultValue={item.note ?? ''} placeholder="メモ（任意）" />
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
          <input type="checkbox" name="placeSpecific" value="1" defaultChecked={Boolean(item.placeSpecific)} />
          場所が分かる画像（自動で使うのは超バズ特化型だけ）
        </label>
        <select name="accountId" defaultValue={item.accountId ?? ''}>
          <option value="">全名義で使う</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              @{a.name} だけ
            </option>
          ))}
        </select>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SubmitButton className="btn btn-primary" pendingLabel="保存中…">
            保存
          </SubmitButton>
          {state?.error && <span className="over" style={{ fontSize: 12 }}>{state.error}</span>}
          {state?.ok && <span style={{ color: 'var(--ok)', fontSize: 12 }}>{state.ok}</span>}
        </div>
      </form>
    </details>
  );
}
