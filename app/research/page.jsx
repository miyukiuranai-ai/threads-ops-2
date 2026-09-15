import { listAccounts } from '@/lib/server/repo.mjs';
import { VERDICT_LABEL } from '@/lib/server/impressions.mjs';
import { getCurrentUser, filterAccountsForUser } from '@/lib/server/auth.mjs';
import { toJstLabel } from '@/lib/server/schedule.mjs';
import { COLLECT_AT } from '@/lib/server/insights.mjs';
import { POST_TYPES } from '@/lib/server/generate.mjs';
import { getDb } from '@/lib/server/firebase.mjs';
import { REFERENCES_COLLECTION } from '@/lib/server/references.mjs';
import { WATCHLIST_COLLECTION, watchUrl } from '@/lib/server/watchlist.mjs';
import {
  loadSignups,
  joinDaily,
  byAccountTotals,
  correlation,
  asPercent,
} from '@/lib/server/signups.mjs';
import SignupForm from './SignupForm';
import { loadReports } from '@/lib/server/report.mjs';
import ReportButton from './ReportButton';
import WatchlistForm from './WatchlistForm';
import WatchRow from './WatchRow';
import { removeReference } from '../_actions/references';
import ReferenceForm from './ReferenceForm';
import TestimonialForm from './TestimonialForm';
import AlertActions from './AlertActions';
import NoteForm from './NoteForm';
import { removeTomorrowNote } from '../_actions/directives';
import { ALL_ACCOUNTS } from '@/lib/server/directives.mjs';
import { loadDirectivesFor } from '@/lib/server/directives.mjs';
import { tomorrowJst } from '@/lib/server/pipeline.mjs';
import { removeTestimonial } from '../_actions/testimonials';
import { loadTestimonials } from '@/lib/server/testimonials.mjs';
import SubmitButton from '../_components/SubmitButton';
import {
  loadHistory,
  byBand,
  byAccount,
  byWeekday,
  topPosts,
  suggestChances,
  lastFetchedAt,
  THIN_SAMPLE,
} from '@/lib/server/research.mjs';

export const dynamic = 'force-dynamic';

/** 中央値を棒で見せる。数字だけだと差が掴みにくいため。 */
function Bar({ value, max }) {
  const width = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="bar" style={{ minWidth: 90 }}>
      <span style={{ width: `${width}%` }} />
    </div>
  );
}

function Row({ label, data, max }) {
  return (
    <tr>
      <td>{label}</td>
      <td style={{ width: 60 }}>
        {data.count}
        {data.thin && data.count > 0 && (
          <span className="post-slot"> 参考値</span>
        )}
      </td>
      <td style={{ width: 90 }} className="num">
        {data.count ? data.medianViews.toLocaleString() : '-'}
      </td>
      <td style={{ width: 130 }}>
        <Bar value={data.medianViews} max={max} />
      </td>
      <td style={{ width: 70 }} className="num">
        {data.count ? data.medianLikes : '-'}
      </td>
      <td style={{ width: 70 }} className="num">
        {data.count ? data.medianReplies : '-'}
      </td>
    </tr>
  );
}

export default async function ResearchPage({ searchParams }) {
  const params = await searchParams;
  const user = await getCurrentUser();

  let accounts = [];
  let voices = [];
  let directives = new Map();
  let rows = [];
  let refs = [];
  let watches = [];
  let daily = [];
  let totals = [];
  let reports = [];
  let dbError = null;
  try {
    accounts = filterAccountsForUser(await listAccounts(), user);
    voices = await loadTestimonials({ accountIds: accounts.map((a) => a.id) });
    directives = await loadDirectivesFor(tomorrowJst());
    rows = await loadHistory({
      accountIds: user.role === 'admin' ? null : accounts.map((a) => a.id),
    });
    const refSnap = await getDb().collection(REFERENCES_COLLECTION).limit(300).get();
    refs = refSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));

    const watchSnap = await getDb().collection(WATCHLIST_COLLECTION).limit(300).get();
    // 競合の情報は分ける理由がないので、ツールを触る全員で共有する
    watches = watchSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
    const signups = await loadSignups({
      accountIds: user.role === 'admin' ? null : accounts.map((a) => a.id),
    });
    daily = joinDaily(rows, signups);
    totals = byAccountTotals(daily);

    const visible = new Set(accounts.map((a) => a.name));
    reports = (await loadReports({ limit: 3 })).map((r) => ({
      ...r,
      accounts: (r.accounts ?? []).filter((a) => user.role === 'admin' || visible.has(a.account)),
    }));
  } catch (err) {
    dbError = err.message;
  }

  // 名義を絞り込めるようにする
  const selected = params?.account ?? null;
  const scoped = selected ? rows.filter((r) => r.accountId === selected) : rows;

  const bands = byBand(scoped);
  const accountsStats = byAccount(scoped);
  const weekdays = byWeekday(scoped);
  const top = topPosts(scoped, 8);
  const suggestions = suggestChances(bands);
  const fetched = lastFetchedAt(rows);

  const maxBand = Math.max(1, ...bands.map((b) => b.medianViews));
  const maxWeekday = Math.max(1, ...weekdays.map((b) => b.medianViews));
  const maxAccount = Math.max(1, ...accountsStats.map((b) => b.medianViews));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>リサーチ</h1>
          <p className="page-desc">
            自分の投稿がどれだけ見られたかを集計します。表示数の中央値で見ています
            （平均は1本のバズに引っ張られるため）。
          </p>
        </div>
        <span className="badge">
          {rows.length}件・直近60日
        </span>
      </div>

      {dbError && (
        <div className="notice">
          <strong>Firestore に接続できていません。</strong>
          <div style={{ marginTop: 6 }}>{dbError}</div>
        </div>
      )}

      <div className="filter-row">
        <a className="filter-chip" data-active={!selected} href="/research">
          すべて
        </a>
        {accounts.map((a) => (
          <a
            key={a.id}
            className="filter-chip"
            data-active={selected === a.id}
            href={`/research?account=${a.id}`}
          >
            @{a.name}
          </a>
        ))}
      </div>

      {reports.length === 0 && (
        <section className="card">
          <div className="card-head">
            <div className="card-title">✦ 昨日のレポート <small>まだありません</small></div>
            <ReportButton />
          </div>
          <p className="stat-note" style={{ marginTop: 0 }}>
            毎日15:30ごろに自動で作ります。いますぐ見たいときは「いま作り直す」を押してください。
          </p>
        </section>
      )}

      {reports.length > 0 && (
        <section className="card">
          <div className="card-head">
            <div className="card-title">
              ✦ 昨日のレポート <small>{reports[0].date}</small>
            </div>
            <ReportButton />
          </div>
          <p className="stat-note" style={{ marginTop: 0 }}>
            毎日15:30ごろ、翌日ぶんの生成の前に自動で作ります。待たずに見たいときは「いま作り直す」。
            同じ日付のものは上書きされます。反応の取り込みは毎日3:20なので、それより前に作ると数字が古いことがあります。
          </p>

          {reports[0].overall && <p className="report-overall">{reports[0].overall}</p>}

          {(reports[0].stats ?? []).some((s) => s.stage?.advice) && (
            <div style={{ display: 'grid', gap: 6, margin: '8px 0 10px' }}>
              <div className="stat-note" style={{ margin: 0 }}>段階の判定（数字から機械的に。決めるのはあなたです）</div>
              {reports[0].stats
                .filter((s) => s.stage?.advice)
                .map((s) => (
                  <div className="report-line" key={`st${s.account}`}>
                    <span className="badge" data-tone={s.stage.level === '落ち込み' ? 'danger' : s.stage.level === '好調' ? 'ok' : 'warn'}>
                      {s.stage.stage}
                    </span>
                    <span>
                      <strong>@{s.account}</strong> {s.stage.advice}
                    </span>
                  </div>
                ))}
            </div>
          )}

          {(reports[0].alerts ?? []).length > 0 && (
            <div style={{ display: 'grid', gap: 6, margin: '8px 0 14px' }}>
              {reports[0].alerts.map((al, i) => (
                <div className="report-line" key={`al${i}`}>
                  <span
                    className="badge"
                    data-tone={al.level === '落ち込み' ? 'danger' : al.level === '好調' ? 'ok' : 'warn'}
                  >
                    {al.level}
                  </span>
                  <span style={{ flex: 1 }}>
                    <strong>@{al.account}</strong> {al.message}
                    {al.proposal && <em style={{ display: 'block', opacity: 0.85 }}>提案: {al.proposal}</em>}
                    {(() => {
                      const acc = accounts.find((a) => a.name === al.account);
                      return acc ? (
                        <AlertActions
                          accountId={acc.id}
                          accountName={acc.name}
                          current={directives.get(acc.id)?.action ?? null}
                        />
                      ) : null;
                    })()}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-2">
            {reports[0].accounts.map((a) => {
              const stat = (reports[0].stats ?? []).find((s) => s.account === a.account);
              return (
                <div className="stage" key={a.account}>
                  <div className="stage-name">
                    @{a.account}
                    {stat && (
                      <span className="post-slot" style={{ fontWeight: 400 }}>
                        {' '}
                        表示{stat.views.toLocaleString()}
                        {stat.signups !== null && ` / 追加${stat.signups}`}
                        {stat.per10k !== null && ` / 1万あたり${stat.per10k}人`}
                      </span>
                    )}
                  </div>

                  {stat?.series && (
                    <p className="stat-note" style={{ margin: '4px 0 6px' }}>
                      直近7日（本数 / 1本あたりの表示）:{' '}
                      {stat.series.map((s) => `${s.date.slice(5)} ${s.posts}本/${s.medianViews.toLocaleString()}`).join(' → ')}
                      {stat.momentum && stat.momentum.state !== 'unknown' && (
                        <>
                          {' '}／ 判定: {stat.momentum.state === 'slump' ? '落ち込み' : '通常'}
                          （直近 {stat.momentum.recent.toLocaleString()} / 基準 {stat.momentum.baseline.toLocaleString()}）
                        </>
                      )}
                    </p>
                  )}
                  {stat?.postList?.length > 0 && (
                    <div className="table-scroll" style={{ margin: '0 0 8px' }}>
                      <table style={{ fontSize: 12 }}>
                        <thead>
                          <tr>
                            <th>時刻</th>
                            <th>冒頭</th>
                            <th style={{ textAlign: 'right' }}>1h</th>
                            <th style={{ textAlign: 'right' }}>3h</th>
                            <th>判定</th>
                            <th style={{ textAlign: 'right' }}>表示</th>
                            <th style={{ textAlign: 'right' }}>いいね</th>
                            <th style={{ textAlign: 'right' }}>コメント</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stat.postList.map((p, i) => (
                            <tr key={i}>
                              <td>{p.time}</td>
                              <td>{p.head}</td>
                              <td style={{ textAlign: 'right' }}>{p.views1h != null ? p.views1h.toLocaleString() : '-'}</td>
                              <td style={{ textAlign: 'right' }}>{p.views3h != null ? p.views3h.toLocaleString() : '-'}</td>
                              <td>{p.verdict ? <span className="badge" data-tone={p.verdict === 'bad' ? 'danger' : p.verdict === 'normal' ? 'default' : 'ok'}>{VERDICT_LABEL[p.verdict]}</span> : '-'}</td>
                              <td style={{ textAlign: 'right' }}>{p.views.toLocaleString()}</td>
                              <td style={{ textAlign: 'right' }}>{p.likes}</td>
                              <td style={{ textAlign: 'right' }}>{p.replies}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {(a.keep ?? []).map((k, i) => (
                    <div className="report-line" key={`k${i}`}>
                      <span className="badge" data-tone="ok">続ける</span>
                      {k}
                    </div>
                  ))}
                  {(a.stop ?? []).map((t, i) => (
                    <div className="report-line" key={`s${i}`}>
                      <span className="badge" data-tone="danger">やめる</span>
                      {t}
                    </div>
                  ))}
                  {a.note && <p className="stat-note" style={{ marginTop: 8 }}>{a.note}</p>}
                </div>
              );
            })}
          </div>

          <p className="stat-note">
            ここで出た「続ける・やめる」は、翌日の投稿を作るときにそのまま渡しています。
          </p>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            ✦ 明日への指示 <small>15:30 の生成が読みます（相談の費用はかかりません）</small>
          </div>
        </div>
        <p className="stat-note" style={{ marginTop: 0 }}>
          レポートを読んで決めたことを、ここに書いておきます。名義ごとに「構成（本数と型）」と「指示の文章」を渡せます。
          全名義に共通の指示も書けます。作ったあとに直したいときは、Claude Code から「うたの 23:47 の本文を差し替えて」のように頼みます。
        </p>
        <NoteForm
          accounts={accounts}
          typeOptions={Object.entries(POST_TYPES).map(([key, def]) => ({ key, label: def.label }))}
        />
        {directives.size > 0 && (
          <div className="table-scroll" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 140 }}>名義</th>
                  <th style={{ width: 160 }}>構成</th>
                  <th>指示</th>
                  <th style={{ width: 90 }}>書いた人</th>
                  <th style={{ width: 70 }} />
                </tr>
              </thead>
              <tbody>
                {[...directives.values()].map((d) => (
                  <tr key={d.id}>
                    <td className="post-slot">{d.accountId === ALL_ACCOUNTS ? '全名義' : `@${accounts.find((a) => a.id === d.accountId)?.name ?? d.accountId}`}</td>
                    <td className="post-slot">
                      {d.action === 'mix'
                        ? (d.types ?? []).map((t) => POST_TYPES[t]?.label ?? t).join('＋')
                        : d.action === 'note'
                          ? '（変えない）'
                          : { rest: '休む', one: '1本', one_buzz: '1本バズ', two: '2本', keep: 'そのまま' }[d.action] ?? d.action}
                    </td>
                    <td className="research-body">{d.instruction ?? ''}</td>
                    <td className="post-slot">{d.setBy ?? '-'}</td>
                    <td>
                      <form action={removeTomorrowNote}>
                        <input type="hidden" name="accountId" value={d.accountId} />
                        <input type="hidden" name="date" value={d.date} />
                        <SubmitButton className="btn" pendingLabel="…">
                          削除
                        </SubmitButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            ✦ LINEの追加数 <small>表示数だけでは、集客できたかは分かりません</small>
          </div>
        </div>
        <p className="stat-note" style={{ marginTop: 0 }}>
          毎日の承認のついでに、前日の追加数を入れてください。
          入れた日だけ、下の効率が出せるようになります。
        </p>
        <SignupForm
          accounts={accounts}
          existing={Object.fromEntries(
            daily
              .filter((d) => d.signups !== null)
              .map((d) => [`${d.accountId}_${d.date}`, d.signups])
          )}
        />

        {totals.length > 0 && (
          <>
            <div className="table-scroll" style={{ marginTop: 16 }}>
              <table>
                <thead>
                  <tr>
                    <th>名義</th>
                    <th style={{ width: 60 }}>日数</th>
                    <th style={{ width: 80 }}>表示</th>
                    <th style={{ width: 70 }}>いいね</th>
                    <th style={{ width: 80 }}>コメント</th>
                    <th style={{ width: 70 }}>追加</th>
                    <th style={{ width: 90 }}>登録率</th>
                    <th style={{ width: 120 }}>コメント1件あたり</th>
                  </tr>
                </thead>
                <tbody>
                  {totals.map((t) => (
                    <tr key={t.accountName}>
                      <td>@{t.accountName}</td>
                      <td className="num">{t.days}</td>
                      <td className="num">{t.views.toLocaleString()}</td>
                      <td className="num">{t.likes}</td>
                      <td className="num">{t.replies}</td>
                      <td className="num">
                        <strong>{t.signups}</strong>
                      </td>
                      <td className="num">
                        <strong>{asPercent(t.rate)}</strong>
                      </td>
                      <td className="num">
                        {t.perReply === null ? '-' : `${t.perReply.toFixed(2)}人`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {(() => {
              const withBoth = daily.filter((d) => d.signups !== null && d.views > 0);
              const r = correlation(withBoth.map((d) => [d.views, d.rate]));
              if (r === null) return null;
              return (
                <div className="notice" style={{ marginTop: 14, borderLeftColor: r < -0.3 ? 'var(--warn)' : 'var(--line)' }}>
                  <strong>表示数と登録率の相関: {r}</strong>
                  <div style={{ marginTop: 4 }}>
                    {r < -0.3
                      ? '表示が伸びた日ほど、登録率が下がっています。数字を追うと薄い層に届いている可能性があります。'
                      : r > 0.3
                        ? '表示が伸びた日ほど、登録率も上がっています。いまの型は層を薄めずに届いています。'
                        : '表示数と登録率に、はっきりした関係は出ていません。'}
                    {`（${withBoth.length}日ぶん）`}
                  </div>
                </div>
              );
            })()}

            <h3 style={{ fontSize: 13, margin: '18px 0 6px' }}>日ごと</h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 100 }}>日付</th>
                    <th style={{ width: 130 }}>名義</th>
                    <th style={{ width: 50 }}>本数</th>
                    <th style={{ width: 80 }}>表示</th>
                    <th style={{ width: 70 }}>いいね</th>
                    <th style={{ width: 80 }}>コメント</th>
                    <th style={{ width: 70 }}>追加</th>
                    <th style={{ width: 80 }}>登録率</th>
                  </tr>
                </thead>
                <tbody>
                  {daily
                    .filter((d) => d.signups !== null)
                    .slice(0, 20)
                    .map((d) => (
                      <tr key={`${d.accountId}_${d.date}`}>
                        <td>{d.date.slice(5)}</td>
                        <td>@{d.accountName}</td>
                        <td className="num">{d.posts}</td>
                        <td className="num">{d.views.toLocaleString()}</td>
                        <td className="num">{d.likes}</td>
                        <td className="num">{d.replies}</td>
                        <td className="num">{d.signups}</td>
                        <td className="num">{asPercent(d.rate)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {rows.length === 0 ? (
        <div className="empty">
          まだ集計できる投稿がありません。
          <br />
          毎日 {COLLECT_AT} に自動で取り込みます。すぐ取り込むには{' '}
          <code>npm run analyze:fetch</code>
        </div>
      ) : (
        <>
          <section className="card">
            <div className="card-head">
              <div className="card-title">
                ✦ 時間帯ごとの成績 <small>投稿枠の出現率を決める材料です</small>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>時間帯</th>
                    <th>本数</th>
                    <th>表示数の中央値</th>
                    <th />
                    <th>いいね</th>
                    <th>コメント</th>
                  </tr>
                </thead>
                <tbody>
                  {bands.map((b) => (
                    <Row key={b.key} label={b.label} data={b} max={maxBand} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="stat-note">
              {THIN_SAMPLE}件未満の区分は「参考値」と付けています。数字が動きやすいので、
              これだけで判断しないでください。
            </p>
          </section>

          {suggestions.length > 0 && (
            <section className="card">
              <div className="card-head">
                <div className="card-title">
                  ✦ 出現率の案 <small>キャラ設定の「時間帯ごとの投稿枠」に使えます</small>
                </div>
              </div>
              <pre className="terminal" style={{ minHeight: 0 }}>
                {suggestions
                  .map((s) => `${String(s.from).padStart(2, '0')}:00-${String(s.to).padStart(2, '0')}:00`.replace('24:00', '23:50') + ` ${s.chance}%`.padEnd(6) + `  ← ${s.reason}`)
                  .join('\n')}
              </pre>
              <p className="stat-note">
                いちばん良い時間帯を100%として、表示数の比で割り当てた案です。
                <strong>弱い時間帯も25%より下げていません。</strong>
                0にすると二度と試されず、反応が変わったときに気づけなくなるためです。
                そのまま使う必要はありません。
              </p>
            </section>
          )}

          <div className="grid grid-2">
            <section className="card">
              <div className="card-head">
                <div className="card-title">✦ 曜日ごと</div>
              </div>
              <table>
                <tbody>
                  {weekdays.map((w) => (
                    <Row key={w.label} label={w.label} data={w} max={maxWeekday} />
                  ))}
                </tbody>
              </table>
            </section>

            <section className="card">
              <div className="card-head">
                <div className="card-title">✦ 名義ごと</div>
              </div>
              <table>
                <tbody>
                  {accountsStats.map((a) => (
                    <Row key={a.name} label={`@${a.name}`} data={a} max={maxAccount} />
                  ))}
                </tbody>
              </table>
            </section>
          </div>

          <section className="card">
            <div className="card-head">
              <div className="card-title">
                ✦ 伸びた投稿 <small>表示数の多い順</small>
              </div>
            </div>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 110 }}>日時</th>
                  <th style={{ width: 120 }}>名義</th>
                  <th style={{ width: 80 }}>表示</th>
                  <th style={{ width: 60 }}>いいね</th>
                  <th style={{ width: 70 }}>コメント</th>
                  <th>本文</th>
                </tr>
              </thead>
              <tbody>
                {top.map((p) => (
                  <tr key={p.id}>
                    <td>{toJstLabel(p.timestamp)}</td>
                    <td>
                      {p.permalink ? (
                        <a href={p.permalink} target="_blank" rel="noreferrer">
                          @{p.accountName}
                        </a>
                      ) : (
                        `@${p.accountName}`
                      )}
                    </td>
                    <td className="num">{(p.metrics?.views ?? 0).toLocaleString()}</td>
                    <td className="num">{p.metrics?.likes ?? 0}</td>
                    <td className="num">{p.metrics?.replies ?? 0}</td>
                    <td className="research-body">{String(p.text ?? '').split('\n')[0]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            ✦ 気になるアカウント <small>控え {watches.length}件</small>
          </div>
          {watches.some((w) => (w.status ?? 'candidate') === 'candidate') && (
            <span className="badge" data-tone="warn">
              未判定 {watches.filter((w) => (w.status ?? 'candidate') === 'candidate').length}件
            </span>
          )}
        </div>
        <p className="stat-note" style={{ marginTop: 0 }}>
          タイムラインで見つけたアカウントを控えておく場所です。
          Threads はタイムラインを外から取れないので、見つけるのは人の目になります。
          <strong>ここはツールを触る全員で共有します。</strong>
          溜まったら、下のURL一覧をまとめて渡してください。
        </p>

        <WatchlistForm />

        {watches.length > 0 && (
          <div className="table-scroll" style={{ marginTop: 16 }}>
            <table>
              <thead>
                <tr>
                  <th>アカウント</th>
                  <th style={{ width: 90 }}>控えた人</th>
                  <th style={{ width: 100 }}>判定</th>
                  <th style={{ width: 300 }}>判定を変える</th>
                  <th style={{ width: 130 }} />
                </tr>
              </thead>
              <tbody>
                {watches.map((w) => (
                  <WatchRow key={w.id} entry={w} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {watches.some((w) => (w.status ?? 'candidate') === 'candidate') && (
          <>
            <h3 style={{ fontSize: 13, margin: '18px 0 6px' }}>まだ判定していないURL</h3>
            <pre className="terminal" style={{ minHeight: 0 }}>
              {watches
                .filter((w) => (w.status ?? 'candidate') === 'candidate')
                .map((w) => watchUrl(w.username) + (w.note ? `   ${w.note}` : ''))
                .join('\n')}
            </pre>
            <p className="stat-note">これをそのままコピーして渡してもらえれば、まとめて判定します。</p>
          </>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            ✦ お客様の声 <small>未使用 {voices.filter((v) => !v.usedAt).length}件 / 全 {voices.length}件</small>
          </div>
        </div>
        <p className="stat-note" style={{ marginTop: 0 }}>
          鑑定を受けた方からもらった言葉を貼っておくと、その名義の投稿にたまに1件ずつ「声を引く型」として混ぜます。
          一部を「」でそのまま引用し、要約や脚色はしません。落ち込み中の名義には使いません。
        </p>
        <TestimonialForm accounts={accounts} />
        {voices.length > 0 && (
          <div className="table-scroll" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 140 }}>名義</th>
                  <th>冒頭</th>
                  <th style={{ width: 120 }}>状態</th>
                  <th style={{ width: 70 }} />
                </tr>
              </thead>
              <tbody>
                {voices.slice(0, 40).map((v) => (
                  <tr key={v.id}>
                    <td className="post-slot">@{accounts.find((a) => a.id === v.accountId)?.name ?? v.accountId}</td>
                    <td className="research-body">{String(v.text ?? '').split('\n')[0]}</td>
                    <td className="post-slot">{v.usedAt ? `使用済み ${String(v.usedAt).slice(5, 10)}` : '未使用'}</td>
                    <td>
                      <form action={removeTestimonial}>
                        <input type="hidden" name="id" value={v.id} />
                        <SubmitButton className="btn" pendingLabel="…">
                          削除
                        </SubmitButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            ✦ お手本にする投稿 <small>登録済み {refs.length}本</small>
          </div>
        </div>
        <p className="stat-note" style={{ marginTop: 0 }}>
          他人の投稿の自動収集は、Threads 側の権限がまだ通っていないため使えません。
          見つけた投稿は、ここに貼り付けて教材にできます。
        </p>
        <ReferenceForm
          typeOptions={Object.entries(POST_TYPES).map(([key, def]) => ({ key, label: def.label }))}
        />
      </section>

      {refs.length > 0 && (
        <section className="card">
          <div className="card-head">
            <div className="card-title">✦ 登録済みのお手本</div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 110 }}>型</th>
                  <th style={{ width: 60 }}>文字数</th>
                  <th>冒頭</th>
                  <th style={{ width: 150 }}>出どころ</th>
                  <th style={{ width: 70 }} />
                </tr>
              </thead>
              <tbody>
                {refs.slice(0, 40).map((r) => (
                  <tr key={r.id}>
                    <td>{POST_TYPES[r.category]?.label ?? r.category}</td>
                    <td className="num">{r.charCount ?? '-'}</td>
                    <td className="research-body">{String(r.text ?? '').split('\n')[0]}</td>
                    <td className="post-slot">{r.source ?? '-'}</td>
                    <td>
                      <form action={removeReference}>
                        <input type="hidden" name="id" value={r.id} />
                        <SubmitButton className="btn" pendingLabel="…">
                          削除
                        </SubmitButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {refs.length > 40 && (
            <p className="stat-note">新しい40本だけ表示しています（全{refs.length}本）。</p>
          )}
        </section>
      )}

      <p className="stat-note">
        毎日 {COLLECT_AT} に自動で取り込みます。
        {fetched && `最後の取り込み: ${toJstLabel(fetched)}`}
      </p>
    </>
  );
}
