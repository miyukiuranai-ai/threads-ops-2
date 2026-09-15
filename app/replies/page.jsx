import { pageContext } from '../_lib/session';
import { listRepliesForView, listTemplates, REPLY_CATEGORIES } from '@/lib/server/replies.mjs';
import { formatJst } from '@/lib/server/time.mjs';
import { setReplyStatusAction, addTemplateAction, deleteTemplateAction } from '../_actions/replies';
import SubmitButton from '../_components/SubmitButton';
import AccountFilter from '../_components/AccountFilter';

export const dynamic = 'force-dynamic';
const STATUS_JA = { new: '未判定', queued: '送信待ち', skipped: '送らない', sent: '送信済み', failed: '失敗' };

export default async function RepliesPage({ searchParams }) {
  const { selected, accountIds, accounts, sp } = await pageContext(searchParams);
  const status = typeof sp.status === 'string' ? sp.status : undefined;
  const [replies, templates] = await Promise.all([listRepliesForView({ accountIds, status }), listTemplates()]);
  return (
    <div>
      <h1>リプライ</h1>
      <AccountFilter selected={selected} base="/replies" />
      <div className="tabs">
        {[['', 'すべて'], ['new', '未判定'], ['queued', '送信待ち'], ['sent', '送信済み'], ['skipped', '送らない'], ['failed', '失敗']].map(([s, l]) => (
          <a key={s} href={`/replies?${s ? `status=${s}&` : ''}${selected ? `account=${selected.id}` : ''}`} className={(status || '') === s ? 'active' : ''}>{l}</a>
        ))}
      </div>
      <div className="card">
        <table>
          <thead><tr><th>時刻</th><th>名義</th><th>投稿者</th><th>コメント</th><th>種別</th><th>判定</th><th>状態</th><th></th></tr></thead>
          <tbody>
            {replies.map((r) => (
              <tr key={r.id}>
                <td>{formatJst(r.timestamp)}{r.arrivedAtNight && <span className="badge"> 深夜</span>}</td>
                <td>@{r.accountName}</td>
                <td>{r.username}</td>
                <td>{r.text || <span className="muted">（{r.mediaType}）</span>}{r.sentText && <div className="muted">→ {r.sentText.slice(0, 80)}</div>}</td>
                <td>{r.category === 'keyword' ? '合言葉' : '文章'}</td>
                <td>{r.verdict || '-'}{r.skipReason && <div className="muted">{r.skipReason}</div>}</td>
                <td><span className={`badge ${r.status === 'sent' ? 'ok' : r.status === 'failed' ? 'danger' : ''}`}>{STATUS_JA[r.status] || r.status}</span></td>
                <td>
                  {['new', 'skipped'].includes(r.status) && <form action={setReplyStatusAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="queued" /><SubmitButton className="ghost small">送る</SubmitButton></form>}
                  {['new', 'queued'].includes(r.status) && <form action={setReplyStatusAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="skipped" /><SubmitButton className="ghost small">送らない</SubmitButton></form>}
                </td>
              </tr>
            ))}
            {!replies.length && <tr><td colSpan={8} className="muted">ありません</td></tr>}
          </tbody>
        </table>
      </div>
      <h2>返信テンプレート</h2>
      <div className="card">
        <table>
          <thead><tr><th>名義</th><th>種別</th><th>文面（{'{name}'} は投稿者名、{'{line}'} は誘導先）</th><th></th></tr></thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id}><td>{t.accountName ? `@${t.accountName}` : '共通'}</td><td>{t.category}</td><td>{t.text}</td>
                <td><form action={deleteTemplateAction}><input type="hidden" name="id" value={t.id} /><SubmitButton className="ghost small" confirm="消しますか？">削除</SubmitButton></form></td></tr>
            ))}
          </tbody>
        </table>
        <form action={addTemplateAction} className="stack" style={{ marginTop: 12 }}>
          <div className="row">
            <span><label>名義（空なら共通）</label><select name="accountName" defaultValue=""><option value="">共通</option>{accounts.map((a) => <option key={a.id} value={a.name}>@{a.name}</option>)}</select></span>
            <span><label>種別</label><select name="category">{REPLY_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></span>
          </div>
          <label>文面</label>
          <textarea name="text" placeholder="{name} 様、このたびはご連絡いただきありがとうございます。鑑定文が2000文字を超えてまいりますので、プロフィールのリンクよりご連絡いただけますでしょうか" />
          <SubmitButton className="small">追加</SubmitButton>
        </form>
      </div>
    </div>
  );
}
