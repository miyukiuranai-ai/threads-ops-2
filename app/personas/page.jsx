import Link from 'next/link';
import { pageContext } from '../_lib/session';
import { listPersonas } from '@/lib/server/accounts.mjs';
import { linkPersonaAction } from '../_actions/personas';
import SubmitButton from '../_components/SubmitButton';

export const dynamic = 'force-dynamic';

export default async function PersonasPage({ searchParams }) {
  const { session, accounts, selected } = await pageContext(searchParams);
  const personas = await listPersonas();
  const visible = session.role === 'admin' ? personas : personas.filter((p) => accounts.some((a) => a.personaId === p.id));
  const list = selected ? accounts.filter((a) => a.id === selected.id) : accounts;
  return (
    <div>
      <h1>キャラ設定</h1>
      <div className="card">
        <table>
          <thead><tr><th>名義</th><th>Persona</th><th>本数</th><th>構成（dayMix）</th><th>model</th><th></th></tr></thead>
          <tbody>
            {list.map((a) => {
              const p = personas.find((x) => x.id === a.personaId);
              return (
                <tr key={a.id}>
                  <td>@{a.name}</td>
                  <td>{p ? <Link href={`/personas/${encodeURIComponent(p.id)}`}>{p.name || p.id}</Link> : <span className="muted">未設定</span>}</td>
                  <td>{p?.postsPerDay || '-'}</td>
                  <td>{(p?.dayMix || []).join(', ') || '-'}</td>
                  <td>{p?.model || '-'}</td>
                  <td>
                    <div className="row">
                      <Link className="btn ghost small" href={`/personas/new?account=${a.id}`}>新規作成</Link>
                      {visible.length > 0 && (
                        <form action={linkPersonaAction} className="row">
                          <input type="hidden" name="accountId" value={a.id} />
                          <select name="personaId" defaultValue={a.personaId || ''} style={{ width: 160 }}>{visible.map((x) => <option key={x.id} value={x.id}>{x.name || x.id}</option>)}</select>
                          <SubmitButton className="ghost small">紐づけ</SubmitButton>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <h2>Persona 一覧</h2>
      <div className="grid">
        {visible.map((p) => (
          <div className="card" key={p.id}>
            <b><Link href={`/personas/${encodeURIComponent(p.id)}`}>{p.name || p.id}</Link></b>
            <p className="muted">{(p.characterDoc || '').slice(0, 120)}</p>
            <p className="muted">{p.postsPerDay} 本 / 合言葉 {p.askPerDay} / {p.imagePolicy} / {p.model}</p>
          </div>
        ))}
        {!visible.length && <p className="muted">Persona がありません。名義の行から新規作成してください。</p>}
      </div>
    </div>
  );
}
