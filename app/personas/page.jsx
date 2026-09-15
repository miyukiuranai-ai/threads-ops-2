import Link from 'next/link';
import { listAccounts, listPersonas } from '@/lib/server/repo.mjs';
import { getCurrentUser, filterAccountsForUser, groupLabel } from '@/lib/server/auth.mjs';

export const dynamic = 'force-dynamic';

export default async function PersonasPage() {
  const user = await getCurrentUser();

  let accounts = [];
  let personas = [];
  let dbError = null;
  try {
    const [allAccounts, allPersonas] = await Promise.all([listAccounts(), listPersonas()]);
    accounts = filterAccountsForUser(allAccounts, user);
    const visible = new Set(accounts.map((a) => a.personaId).filter(Boolean));
    personas = user.role === 'admin' ? allPersonas : allPersonas.filter((p) => visible.has(p.id));
  } catch (err) {
    dbError = err.message;
  }

  const missing = accounts.filter((a) => !a.personaId);
  const byId = new Map(personas.map((p) => [p.id, p]));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>キャラ設定</h1>
          <p className="page-desc">
            名義ごとの人物像と投稿ルールです。ここが決まっていないと投稿文は作られません。
          </p>
        </div>
      </div>

      {dbError && (
        <div className="notice">
          <strong>Firestore に接続できていません。</strong>
          <div style={{ marginTop: 6 }}>{dbError}</div>
        </div>
      )}

      {missing.length > 0 && (
        <section className="card">
          <div className="card-head">
            <div className="card-title">
              ✦ 設定がまだの名義 <small>{missing.length}件</small>
            </div>
          </div>
          <p className="stat-note" style={{ marginTop: 0 }}>
            この名義は投稿文が作られません。キャラ設定を作ると、翌日ぶんから生成が始まります。
          </p>
          <div className="filter-row" style={{ marginBottom: 0 }}>
            {missing.map((a) => (
              <Link key={a.id} className="btn btn-primary" href={`/personas/new?account=${a.id}`}>
                @{a.name} のキャラ設定を作る
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            ✦ 登録済み <small>{personas.length}件</small>
          </div>
        </div>

        {personas.length === 0 ? (
          <div className="stat-note">まだありません。</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>名前</th>
                <th>使っている名義</th>
                <th style={{ width: 150 }}>担当</th>
                <th style={{ width: 150 }}>本数 / 時間帯</th>
                <th style={{ width: 110 }}>間隔</th>
                <th style={{ width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {personas.map((p) => {
                const used = accounts.filter((a) => a.personaId === p.id);
                return (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.name}</strong>
                      <div className="post-slot">
                        <code>{p.id}</code>
                      </div>
                    </td>
                    <td>
                      {used.length ? (
                        used.map((a) => `@${a.name}`).join(', ')
                      ) : (
                        <span className="badge" data-tone="warn">
                          未使用
                        </span>
                      )}
                    </td>
                    <td>
                      {used.length ? groupLabel(used[0].group) : '-'}
                    </td>
                    <td>
                      {p.postsPerDay ?? '-'}本 / {p.activeWindow ?? '-'}
                    </td>
                    <td>{p.minGap ? `${p.minGap}分` : '-'}</td>
                    <td>
                      <Link className="btn" href={`/personas/${p.id}`}>
                        編集
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {byId.size > 0 && (
        <p className="stat-note">
          設定を変えても、すでに作られた投稿案は書き換わりません。次の生成（毎日15:30ごろ）から反映されます。
        </p>
      )}
    </>
  );
}
