import { pageContext } from '../_lib/session';
import { listStock } from '@/lib/server/stock.mjs';
import { updateStockAction, deleteStockAction } from '../_actions/stock';
import SubmitButton from '../_components/SubmitButton';
import StockUploader from './StockUploader';

export const dynamic = 'force-dynamic';

export default async function StockPage({ searchParams }) {
  const { accounts, selected } = await pageContext(searchParams);
  const stock = await listStock({ accountId: selected ? selected.id : undefined });
  const groups = {};
  for (const s of stock) {
    const k = `${s.kind === 'pair' ? '2枚（くっつけ）' : '1枚'} / ${s.accountId ? `@${accounts.find((a) => a.id === s.accountId)?.name || s.accountId}` : '全名義'} / ${s.genre}`;
    (groups[k] ||= []).push(s);
  }
  return (
    <div>
      <h1>画像ストック</h1>
      <p className="muted">超バズ特化型は必ずここから付ける。バズ特化型・霊視開始型は場所の分からない1枚を付けたり付けなかったり。属人型には付けない（土地移動・寺社訪問は人が付ける）。使い回しは構わない。</p>
      <h2>まとめて登録</h2>
      <StockUploader accounts={accounts.map((a) => ({ id: a.id, name: a.name }))} />
      <h2>一覧（種類 → 名義 → 系統）: {stock.length} 件</h2>
      {Object.entries(groups).map(([k, list]) => (
        <div className="card" key={k}>
          <b>{k}</b> <span className="muted">{list.length} 件</span>
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>説明</th><th>系統</th><th>名義</th><th>場所の印</th><th className="num">使用</th><th>ファイル</th><th></th></tr></thead>
            <tbody>{list.map((s) => (
              <tr key={s.id}>
                <td colSpan={4}>
                  <form action={updateStockAction} className="row">
                    <input type="hidden" name="id" value={s.id} />
                    <input name="note" defaultValue={s.note} placeholder="説明（漢字なら字、土地なら「大阪府 住吉大社」）" style={{ flex: 2 }} />
                    <input name="genre" defaultValue={s.genre} placeholder="系統" style={{ flex: 1 }} />
                    <select name="accountId" defaultValue={s.accountId || ''} style={{ width: 140 }}><option value="">全名義</option>{accounts.map((a) => <option key={a.id} value={a.id}>@{a.name}</option>)}</select>
                    <label className="inline"><input type="checkbox" name="placeSpecific" defaultChecked={s.placeSpecific} /> 場所</label>
                    <SubmitButton className="ghost small">編集</SubmitButton>
                  </form>
                </td>
                <td className="num">{s.usedTotal || 0}</td>
                <td className="muted">{(s.files || []).map((f) => f.path.split('/').pop().slice(0, 10)).join(', ')}</td>
                <td><form action={deleteStockAction}><input type="hidden" name="id" value={s.id} /><SubmitButton className="ghost small" confirm="外しますか？">外す</SubmitButton></form></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ))}
      {!stock.length && <div className="card muted">在庫がありません。</div>}
    </div>
  );
}
