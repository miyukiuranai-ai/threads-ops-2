import { pageContext } from '../_lib/session';
import { listPersonas, tokenDaysLeft } from '@/lib/server/accounts.mjs';
import { balanceStatus, getBalance } from '@/lib/server/settings.mjs';
import { getLines } from '@/lib/server/impressions.mjs';
import { modeLabel } from '@/lib/server/guard.mjs';
import { formatJst } from '@/lib/server/time.mjs';
import { addAccountAction, updateAccountFlagsAction, deleteAccountAction, setBalanceAction, importTokenAction } from '../_actions/settings';
import SubmitButton from '../_components/SubmitButton';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ searchParams }) {
  const { session, accounts } = await pageContext(searchParams);
  const [personas, balance, bal, lines] = await Promise.all([listPersonas(), balanceStatus().catch(() => null), getBalance().catch(() => null), getLines()]);
  const modes = modeLabel();
  return (
    <div>
      <h1>設定</h1>
      <p className="muted">POSTING_MODE={modes.posting} / REPLY_MODE={modes.reply}（環境変数）。表示数の線: 悪い&lt;{lines.bad} / 良い≧{lines.good} / バズ≧{lines.buzz}（npm run ops -- lines か相談で変更）</p>

      <h2>名義</h2>
      {await Promise.all(accounts.map(async (a) => {
        const days = await tokenDaysLeft(a);
        return (
          <div className="card" key={a.id}>
            <div className="row spread">
              <b>@{a.name}</b>
              <span className="muted">group {a.group || 'main'} / threadsUserId {a.threadsUserId || '-'} / トークン {days == null ? '未登録' : `残り ${days} 日（${formatJst(a.tokenExpiresAt)}）`}</span>
            </div>
            <form action={updateAccountFlagsAction} className="row" style={{ marginTop: 8 }}>
              <input type="hidden" name="id" value={a.id} />
              <label className="inline"><input type="checkbox" name="active" defaultChecked={a.status === 'active'} /> 稼働</label>
              <label className="inline"><input type="checkbox" name="autoReply" defaultChecked={a.autoReply} /> 自動返信</label>
              <label className="inline"><input type="checkbox" name="manualOnly" defaultChecked={a.manualOnly} /> 手動承認のみ</label>
              <label className="inline"><input type="checkbox" name="autoReviewExempt" defaultChecked={a.autoReviewExempt} /> 自動仕分けから外す</label>
              <SubmitButton className="ghost small">保存</SubmitButton>
            </form>
            <details style={{ marginTop: 8 }}>
              <summary>トークンの取り込み</summary>
              <form action={importTokenAction} className="row"><input type="hidden" name="id" value={a.id} /><input name="accessToken" placeholder="長期トークン" style={{ flex: 1 }} /><SubmitButton className="ghost small">取り込む</SubmitButton></form>
            </details>
            <details style={{ marginTop: 8 }}>
              <summary className="error">名義の削除（投稿・返信・履歴・カーソル・集計・孤立した Persona を消す）</summary>
              <form action={deleteAccountAction} className="row"><input type="hidden" name="id" value={a.id} /><input name="confirmName" placeholder={`確認のため ${a.name} と入力`} style={{ width: 240 }} /><SubmitButton className="danger small" confirm="本当に削除しますか？取り消せません。">削除</SubmitButton></form>
            </details>
          </div>
        );
      }))}

      <h2>名義の追加（トークンの取り込み）</h2>
      <div className="card">
        <form action={addAccountAction} className="stack">
          <label>長期トークン（入れると @ユーザー名と ID を Threads から取る）</label>
          <input name="accessToken" />
          <div className="row">
            <span><label>@ユーザー名（トークン無しなら必須）</label><input name="name" /></span>
            <span><label>threadsUserId</label><input name="threadsUserId" /></span>
            {session.role === 'admin' && <span><label>group</label><input name="group" defaultValue="main" /></span>}
            <span><label>有効日数</label><input name="expiresDays" type="number" defaultValue={60} /></span>
            <span><label>Persona</label><select name="personaId" defaultValue=""><option value="">あとで</option>{personas.map((p) => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}</select></span>
          </div>
          <SubmitButton className="small">追加</SubmitButton>
        </form>
        <p className="muted">コマンドなら npm run auth:url → 認可 → npm run auth:exchange → npm run token:import。</p>
      </div>

      {session.role === 'admin' && (
        <>
          <h2>Anthropic の残高</h2>
          <div className="card">
            <p>{balance ? balance.message : '-'} {bal?.updatedAt && <span className="muted">（入力 {formatJst(bal.updatedAt)}: ${bal.balanceUsd}）</span>}</p>
            <form action={setBalanceAction} className="row"><input name="usd" type="number" step="0.01" placeholder="残高 USD" style={{ width: 160 }} /><SubmitButton className="small">保存</SubmitButton></form>
            <p className="muted">消費は runs の usage から見積もる。7日で警告、3日で危険。</p>
          </div>
        </>
      )}
    </div>
  );
}
