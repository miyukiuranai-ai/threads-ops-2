import { pageContext } from '../_lib/session';
import { getReport } from '@/lib/server/report.mjs';
import { listDirectives, ACTION_JA } from '@/lib/server/directives.mjs';
import { listSignups } from '@/lib/server/signups.mjs';
import { aggregates } from '@/lib/server/research.mjs';
import { listWatch, WATCH_STATUSES } from '@/lib/server/watchlist.mjs';
import { listTestimonials } from '@/lib/server/testimonials.mjs';
import { listReferences, countByCategory } from '@/lib/server/references.mjs';
import { TYPE_KEYS, POST_TYPES, typeName } from '@/lib/server/post-types.mjs';
import { VERDICT_JA } from '@/lib/server/impressions.mjs';
import { jstDate, addDays, WEEKDAYS_JA, formatJst } from '@/lib/server/time.mjs';
import { setDirectiveAction, setSignupsAction, addWatchAction, judgeWatchAction, deleteWatchAction, addTestimonialAction, deleteTestimonialAction, addReferenceAction, deleteReferenceAction } from '../_actions/research';
import SubmitButton from '../_components/SubmitButton';
import ApiButton from '../_components/ApiButton';
import AccountFilter from '../_components/AccountFilter';

export const dynamic = 'force-dynamic';

export default async function ResearchPage({ searchParams }) {
  const { accounts, selected, sp } = await pageContext(searchParams);
  const today = jstDate();
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  const reportDate = typeof sp.report === 'string' ? sp.report : yesterday;
  const list = selected ? [selected] : accounts;
  const [report, directives, signups, agg, watch, testimonials, refs, refCounts] = await Promise.all([
    getReport(reportDate), listDirectives({ from: today }), listSignups({ from: addDays(today, -7) }), aggregates(list, { days: 30 }).catch(() => null), listWatch(), listTestimonials({ accountId: selected?.id }), listReferences(), countByCategory(),
  ]);
  const names = new Set(list.map((a) => a.name));
  const stats = (report?.stats || []).filter((s) => names.has(s.account));
  const alerts = (report?.alerts || []).filter((a) => names.has(String(a.account).replace(/^@/, '')));
  return (
    <div>
      <h1>リサーチ</h1>
      <AccountFilter selected={selected} base="/research" />

      <h2>レポート（{reportDate}）</h2>
      <div className="card">
        <div className="row spread">
          <form method="get" className="row"><input type="date" name="report" defaultValue={reportDate} style={{ width: 160 }} />{selected && <input type="hidden" name="account" value={selected.id} />}<button className="ghost small" type="submit">表示</button></form>
          <ApiButton path="/api/report" body={{ date: reportDate }}>レポートを作り直す</ApiButton>
        </div>
        {!report && <p className="muted">この日のレポートはまだありません。</p>}
        {report && <p style={{ whiteSpace: 'pre-wrap' }}>{report.overall}</p>}
        {alerts.map((a, i) => (
          <div key={i} className={`alert ${a.level === '落ち込み' ? 'danger' : a.level === '好調' ? 'ok' : ''}`}>
            <b>@{String(a.account).replace(/^@/, '')}</b> <span className="badge">{a.level}</span> {a.message}
            {a.proposal && <p className="muted">提案: {a.proposal}</p>}
            <div className="row" style={{ marginTop: 6 }}>
              {[['rest', '休む'], ['one', '1本'], ['one_buzz', '1本バズ'], ['two', '2本'], ['keep', 'そのまま']].map(([act, label]) => (
                <ApiButton key={act} path="/api/directive" body={{ account: String(a.account).replace(/^@/, ''), date: tomorrow, action: act }} className="ghost small">{label}</ApiButton>
              ))}
            </div>
          </div>
        ))}
        {report && (report.accounts || []).filter((x) => names.has(String(x.account).replace(/^@/, ''))).map((x, i) => (
          <div key={i} className="inner" style={{ marginTop: 8 }}>
            <b>@{String(x.account).replace(/^@/, '')}</b> {x.note && <span className="muted">{x.note}</span>}
            {x.keep?.length > 0 && <p>続ける: {x.keep.join(' / ')}</p>}
            {x.stop?.length > 0 && <p>やめる: {x.stop.join(' / ')}</p>}
          </div>
        ))}
        {stats.map((s) => (
          <details key={s.account} style={{ marginTop: 10 }}>
            <summary>@{s.account}: {s.posts} 本 / 表示 {s.views} / LINE {s.signups}（取れ高 {s.per10k}/1万）{s.slump && <span className="badge danger"> 落ち込み</span>} {s.momentum != null && <span className="muted">勢い {s.momentum}%</span>}</summary>
            <p className="muted">直近7日（本数 / 表示の中央値）: {s.series.map((x) => `${x.date.slice(5)} ${x.posts}本/${x.medianViews}`).join('、')}</p>
            <table>
              <thead><tr><th>時刻</th><th>型</th><th className="num">表示</th><th className="num">いいね</th><th className="num">コメント</th><th className="num">1h</th><th className="num">3h</th><th>判定</th><th>本文</th></tr></thead>
              <tbody>{s.postList.map((p) => (
                <tr key={p.threadId}><td>{p.time}</td><td>{typeName(p.type) || '-'}</td><td className="num">{p.views}</td><td className="num">{p.likes}</td><td className="num">{p.replies}</td><td className="num">{p.snap1h ?? '-'}</td><td className="num">{p.snap3h ?? '-'}</td><td>{p.verdict3h ? VERDICT_JA[p.verdict3h] : '-'}</td><td className="muted">{p.text.split('\n')[0].slice(0, 40)}</td></tr>
              ))}</tbody>
            </table>
          </details>
        ))}
      </div>

      <h2>明日への指示（15:30 の生成が読む）</h2>
      <div className="card">
        <form action={setDirectiveAction} className="stack">
          <div className="row">
            <span><label>名義</label><select name="accountId" defaultValue={selected?.id || ''}><option value="">全名義共通</option>{accounts.map((a) => <option key={a.id} value={a.id}>@{a.name}</option>)}</select></span>
            <span><label>対象日</label><input type="date" name="date" defaultValue={tomorrow} /></span>
            <span><label>本数の指示</label><select name="action" defaultValue="note">{Object.entries(ACTION_JA).map(([k, v]) => <option key={k} value={k}>{v}（{k}）</option>)}</select></span>
          </div>
          <label>構成（型キーをカンマ区切り。例: buzz_engagement,attract_intro）</label>
          <input name="types" placeholder={TYPE_KEYS.join(',')} />
          <label>または自由記述（例: バズ2、属人2）</label>
          <input name="mixText" />
          <label>指示の文章（最優先で生成に渡す）</label>
          <textarea name="instruction" />
          <SubmitButton className="small">保存</SubmitButton>
        </form>
        {directives.length > 0 && (
          <table style={{ marginTop: 10 }}>
            <thead><tr><th>対象日</th><th>名義</th><th>指示</th><th>構成</th><th>文章</th><th>設定者</th></tr></thead>
            <tbody>{directives.map((d) => <tr key={d.id}><td>{d.date}</td><td>{d.accountId === '_all_' ? '全名義' : accounts.find((a) => a.id === d.accountId)?.name || d.accountId}</td><td>{ACTION_JA[d.action] || d.action}</td><td>{(d.types || []).join(', ')}</td><td>{d.instruction}</td><td>{d.setBy}</td></tr>)}</tbody>
          </table>
        )}
      </div>

      <h2>LINE 追加数（名義×日。前日ぶん。LINE の数字は前日の投稿に対応）</h2>
      <div className="card">
        <form action={setSignupsAction} className="row">
          <select name="accountId" defaultValue={selected?.id || accounts[0]?.id} style={{ width: 180 }}>{accounts.map((a) => <option key={a.id} value={a.id}>@{a.name}</option>)}</select>
          <input type="date" name="date" defaultValue={yesterday} style={{ width: 160 }} />
          <input type="number" name="count" min="0" placeholder="人数" style={{ width: 100 }} />
          <SubmitButton className="small">保存</SubmitButton>
        </form>
        <table style={{ marginTop: 10 }}>
          <thead><tr><th>日付</th>{list.map((a) => <th key={a.id} className="num">@{a.name}</th>)}</tr></thead>
          <tbody>{Array.from({ length: 7 }, (_, i) => addDays(today, -i)).map((d) => (
            <tr key={d}><td>{d}</td>{list.map((a) => <td key={a.id} className="num">{signups.find((s) => s.accountId === a.id && s.date === d)?.count ?? '-'}</td>)}</tr>
          ))}</tbody>
        </table>
      </div>

      {agg && (
        <>
          <h2>表示数の中央値（直近30日）</h2>
          <div className="grid">
            <div className="card"><h3>時間帯ごと</h3><table><tbody>{Object.entries(agg.byHour).sort().map(([k, v]) => <tr key={k}><td>{k}時</td><td className="num">{v.median}</td><td className="muted">{v.n}本</td></tr>)}</tbody></table></div>
            <div className="card"><h3>曜日ごと</h3><table><tbody>{Object.entries(agg.byWeekday).sort().map(([k, v]) => <tr key={k}><td>{WEEKDAYS_JA[k]}</td><td className="num">{v.median}</td><td className="muted">{v.n}本</td></tr>)}</tbody></table></div>
            <div className="card"><h3>名義ごと</h3><table><tbody>{Object.entries(agg.byAccount).map(([k, v]) => <tr key={k}><td>@{k}</td><td className="num">{v.median}</td><td className="muted">{v.n}本</td></tr>)}</tbody></table></div>
          </div>
          <h2>上位投稿（コメントが付き、いいねもある順）</h2>
          <div className="card"><table><thead><tr><th>名義</th><th>時刻</th><th className="num">表示</th><th className="num">いいね</th><th className="num">コメント</th><th>本文</th></tr></thead>
            <tbody>{agg.top.map((h) => <tr key={h.id}><td>@{h.account}</td><td>{formatJst(h.timestamp)}</td><td className="num">{h.metrics?.views || 0}</td><td className="num">{h.metrics?.likes || 0}</td><td className="num">{h.metrics?.replies || 0}</td><td className="muted">{(h.text || '').split('\n')[0].slice(0, 50)}</td></tr>)}</tbody></table></div>
        </>
      )}

      <h2>監視リスト（全員で共有）</h2>
      <div className="card">
        <form action={addWatchAction} className="row">
          <input name="url" placeholder="https://www.threads.net/@username" style={{ flex: 2 }} />
          <input name="username" placeholder="ユーザー名（URL が無ければ）" style={{ flex: 1 }} />
          <input name="note" placeholder="メモ" style={{ flex: 2 }} />
          <select name="status" defaultValue="candidate" style={{ width: 120 }}>{Object.entries(WATCH_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <SubmitButton className="small">控える</SubmitButton>
        </form>
        <table style={{ marginTop: 10 }}>
          <thead><tr><th>ユーザー</th><th>判定</th><th>メモ・分析</th><th></th></tr></thead>
          <tbody>{watch.map((w) => (
            <tr key={w.id}>
              <td>{w.url ? <a href={w.url} target="_blank" rel="noreferrer">@{w.username}</a> : `@${w.username}`}<div className="muted">{w.addedBy}</div></td>
              <td>
                <form action={judgeWatchAction} className="row">
                  <input type="hidden" name="id" value={w.id} />
                  <select name="status" defaultValue={w.status} style={{ width: 110 }}>{Object.entries(WATCH_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                  <SubmitButton className="ghost small">判定</SubmitButton>
                </form>
              </td>
              <td>
                <form action={judgeWatchAction} className="stack">
                  <input type="hidden" name="id" value={w.id} />
                  <input name="note" defaultValue={w.note} placeholder="メモ" />
                  <textarea name="analysis" defaultValue={w.analysis} placeholder="分析" style={{ minHeight: 50 }} />
                  <SubmitButton className="ghost small">保存</SubmitButton>
                </form>
              </td>
              <td><form action={deleteWatchAction}><input type="hidden" name="id" value={w.id} /><SubmitButton className="ghost small" confirm="消しますか？">削除</SubmitButton></form></td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <h2>お客様の声（名義ごと、1件1回）</h2>
      <div className="card">
        <form action={addTestimonialAction} className="stack">
          <div className="row">
            <select name="accountId" defaultValue={selected?.id || accounts[0]?.id} style={{ width: 180 }}>{accounts.map((a) => <option key={a.id} value={a.id}>@{a.name}</option>)}</select>
            <input name="note" placeholder="メモ" style={{ flex: 1 }} />
          </div>
          <textarea name="text" placeholder="いただいた声" />
          <SubmitButton className="small">追加</SubmitButton>
        </form>
        <table style={{ marginTop: 10 }}><thead><tr><th>名義</th><th>声</th><th>使用</th><th></th></tr></thead>
          <tbody>{testimonials.map((t) => <tr key={t.id}><td>@{accounts.find((a) => a.id === t.accountId)?.name || t.accountId}</td><td>{t.text}</td><td>{t.usedAt ? formatJst(t.usedAt) : '未使用'}</td><td><form action={deleteTestimonialAction}><input type="hidden" name="id" value={t.id} /><SubmitButton className="ghost small">削除</SubmitButton></form></td></tr>)}</tbody></table>
      </div>

      <h2>お手本（references）: {refs.length} 本</h2>
      <div className="card">
        <p className="muted">{TYPE_KEYS.map((k) => `${POST_TYPES[k].name} ${refCounts[k] || 0}`).join(' / ')}</p>
        <form action={addReferenceAction} className="stack">
          <div className="row">
            <span><label>型</label><select name="category">{TYPE_KEYS.map((k) => <option key={k} value={k}>{POST_TYPES[k].name}（{k}）</option>)}</select></span>
            <span style={{ flex: 1 }}><label>使いどころ usage（「求めない」で始めると合言葉なしの手本）</label><input name="usage" /></span>
            <span><label>出所</label><input name="source" /></span>
          </div>
          <div className="row">
            <span style={{ flex: 1 }}><label>強み</label><input name="strength" /></span>
            <span style={{ flex: 1 }}><label>弱み</label><input name="weakness" /></span>
          </div>
          <label>本文</label><textarea name="text" className="body" />
          <SubmitButton className="small">登録</SubmitButton>
        </form>
        <details style={{ marginTop: 10 }}><summary>一覧を開く</summary>
          {refs.map((r) => (
            <div className="post" key={r.id}>
              <div className="head"><span className="badge">{typeName(r.category)}</span> {r.usage && <span>使いどころ: {r.usage}</span>} <span className="muted">{r.charCount}字 {r.lineCount}行</span>
                <form action={deleteReferenceAction}><input type="hidden" name="id" value={r.id} /><SubmitButton className="ghost small" confirm="消しますか？">削除</SubmitButton></form></div>
              <pre className="terminal">{r.text}</pre>
            </div>
          ))}
        </details>
      </div>
    </div>
  );
}
