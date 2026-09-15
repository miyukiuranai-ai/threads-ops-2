import { getCurrentUser, filterAccountsForUser } from '@/lib/server/auth.mjs';
import { listAccounts } from '@/lib/server/repo.mjs';
import { listStock, STOCK_KINDS } from '@/lib/server/stock.mjs';
import { signedUrl } from '@/lib/server/storage.mjs';
import StockUploader from './StockUploader';
import StockEditForm from './StockEditForm';
import SubmitButton from '../_components/SubmitButton';
import { removeStockItem } from '../_actions/stock';

export const dynamic = 'force-dynamic';

/**
 * 画像ストック。
 * 系統（ジャンル）ごとに画像を貯めておき、バズ型の画像投稿に自動で添える。
 */
export default async function StockPage() {
  const user = await getCurrentUser();
  let accounts = [];
  let items = [];
  let dbError = null;
  try {
    accounts = filterAccountsForUser(await listAccounts(), user);
    items = await listStock();
  } catch (err) {
    dbError = err.message;
  }

  // 一覧の見本用に、各件の1枚目だけ短い期限の URL を作る
  const previews = new Map();
  for (const it of items) {
    try {
      previews.set(it.id, await signedUrl(it.files?.[0]?.path, 30));
    } catch {
      // 見本が出なくても一覧は出す
    }
  }

  const genres = [...new Set(items.map((i) => i.genre).filter(Boolean))].sort();
  const byGenre = new Map();
  for (const it of items) {
    const g = it.genre || 'その他';
    byGenre.set(g, [...(byGenre.get(g) ?? []), it]);
  }
  const nameOf = (id) => accounts.find((a) => a.id === id)?.name ?? id;

  return (
    <>
      <section className="card">
        <div className="card-head">
          <div className="card-title">
            ✦ 画像ストック <small>全 {items.length}件 / 系統 {genres.length}</small>
          </div>
        </div>
        <p className="stat-note" style={{ marginTop: 0 }}>
          超バズ特化型の画像投稿（「2本の指でくっつけてみて」「いいねと🍀で運氣が上がります」）に使う画像を、系統ごとに貯めておきます。
          生成のときに、その名義でいちばん使っていないものを自動で添えるので、毎回手で付ける必要がなくなります。使い回しは構いません。
          土地移動型・寺社訪問型の投稿は自動では画像を付けず、「大阪の画像を入れてください」と案内して保留にします。承認のときに、その土地の画像を付けてください。ストックの系統か説明に「大阪府 住吉大社」のように土地の名前があれば、案内にそれも出ます。バズ特化型・属人型の枠にも「場所が分からない1枚」（花、開運系など）だけはまれに添えます。基本は全名義で使え、名義専用のものがあればそれを先に使います。入れていない画像は使われません。
        </p>
        {dbError && <p className="over">{dbError}</p>}
        <StockUploader accounts={accounts} genres={genres} />
      </section>

      {['pair', 'single'].map((kind) => {
        const ofKind = items.filter((i) => (i.kind === 'pair') === (kind === 'pair'));
        // 名義ごと（全名義を先に）→ 系統ごと、の順に分ける
        const byAccount = new Map();
        for (const it of ofKind) {
          const key = it.accountId ?? '';
          byAccount.set(key, [...(byAccount.get(key) ?? []), it]);
        }
        const accountKeys = [...byAccount.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : nameOf(a).localeCompare(nameOf(b))));
        return (
          <section className="card" key={kind}>
            <div className="card-head">
              <div className="card-title">
                ✦ {kind === 'pair' ? '2枚（くっつけ）' : '1枚'} <small>{ofKind.length}件</small>
              </div>
            </div>
            {ofKind.length === 0 && <p className="stat-note">まだありません。</p>}
            {accountKeys.map((accKey) => {
              const list = byAccount.get(accKey);
              const genresHere = new Map();
              for (const it of list) {
                const g = it.genre || 'その他';
                genresHere.set(g, [...(genresHere.get(g) ?? []), it]);
              }
              return (
                <div key={accKey || 'all'} style={{ marginTop: 6 }}>
                  <div className="stage-name" style={{ marginBottom: 6 }}>
                    {accKey ? `@${nameOf(accKey)} だけ` : '全名義で使う'}{' '}
                    <span className="post-slot" style={{ fontWeight: 400 }}>{list.length}件</span>
                  </div>
                  {[...genresHere.entries()].map(([genre, gl]) => (
                    <div key={genre} style={{ margin: '0 0 14px' }}>
                      <div className="stat-note" style={{ margin: '0 0 6px' }}>
                        {genre} <span>（{gl.length}件）</span>
                      </div>
                      <div className="stock-grid">
                        {gl.map((it) => (
                          <div className="stock-item" key={it.id}>
                            {previews.get(it.id) ? (
                              <img src={previews.get(it.id)} alt="" loading="lazy" />
                            ) : (
                              <div className="stock-noimg">（見本なし）</div>
                            )}
                            <div className="stock-meta">
                              <span>{STOCK_KINDS[it.kind]?.label ?? it.kind}</span>
                              <span>{it.placeSpecific ? `場所あり・使用 ${it.usedTotal ?? 0}回` : `使用 ${it.usedTotal ?? 0}回`}</span>
                            </div>
                            {it.note && <div className="stock-note">{it.note}</div>}
                            <StockEditForm item={{ id: it.id, genre: it.genre ?? '', note: it.note ?? '', accountId: it.accountId ?? '', placeSpecific: Boolean(it.placeSpecific) }} accounts={accounts} />
                            <form action={removeStockItem}>
                              <input type="hidden" name="id" value={it.id} />
                              <SubmitButton className="btn" pendingLabel="…">
                                外す
                              </SubmitButton>
                            </form>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </section>
        );
      })}
    </>
  );
}
