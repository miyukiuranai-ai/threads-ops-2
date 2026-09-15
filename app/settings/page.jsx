import { listAccounts, listPersonas, daysUntil } from '@/lib/server/repo.mjs';
import { getCurrentUser, filterAccountsForUser, groupAccounts } from '@/lib/server/auth.mjs';
import { creditStatus, usd, WARN_DAYS } from '@/lib/server/cost.mjs';
import AddAccountForm from './AddAccountForm';
import CreditForm from './CreditForm';
import AccountRow from './AccountRow';

export const dynamic = 'force-dynamic';

/** 環境変数の設定状況だけを返す（値は出さない）。 */
function envStatus() {
  return [
    { key: 'FIREBASE_PROJECT_ID', label: 'Firebase プロジェクト', set: Boolean(process.env.FIREBASE_PROJECT_ID) },
    { key: 'FIREBASE_CLIENT_EMAIL', label: 'Firebase サービスアカウント', set: Boolean(process.env.FIREBASE_CLIENT_EMAIL) },
    { key: 'FIREBASE_PRIVATE_KEY', label: 'Firebase 秘密鍵', set: Boolean(process.env.FIREBASE_PRIVATE_KEY) },
    { key: 'ANTHROPIC_API_KEY', label: 'Anthropic APIキー（投稿生成）', set: Boolean(process.env.ANTHROPIC_API_KEY) },
    { key: 'POSTING_MODE', label: '投稿モード', set: process.env.POSTING_MODE === 'live', note: process.env.POSTING_MODE ?? '未設定' },
    { key: 'REPLY_MODE', label: '返信モード', set: process.env.REPLY_MODE === 'live', note: process.env.REPLY_MODE ?? '未設定' },
  ];
}

export default async function SettingsPage() {
  const user = await getCurrentUser();

  let accounts = [];
  let groups = [];
  let personas = [];
  let dbError = null;
  try {
    const [allAccounts, allPersonas] = await Promise.all([listAccounts(), listPersonas()]);
    accounts = filterAccountsForUser(allAccounts, user);
    groups = groupAccounts(accounts);
    // Persona も、その利用者が見られる名義に紐づくものだけに絞る
    const visible = new Set(accounts.map((a) => a.personaId).filter(Boolean));
    personas = user.role === 'admin' ? allPersonas : allPersonas.filter((p) => visible.has(p.id));
  } catch (err) {
    dbError = err.message;
  }

  const isAdmin = user.role === 'admin';

  let credit = null;
  try {
    credit = await creditStatus();
  } catch {
    // 残高の記録が読めなくても、他の設定は表示する
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>設定</h1>
          <p className="page-desc">
            {isAdmin
              ? 'すべての名義を確認・操作できます。'
              : `あなたのグループ（${user.group}）の名義だけが表示されます。`}
          </p>
        </div>
        <span className="badge" data-tone={isAdmin ? 'ok' : 'default'}>
          {user.name}（{isAdmin ? '管理者' : 'メンバー'}）
        </span>
      </div>

      {dbError && (
        <div className="notice">
          <strong>Firestore に接続できていません。</strong>
          <div style={{ marginTop: 6 }}>{dbError}</div>
        </div>
      )}

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            ✦ 名義を追加 <small>トークンを貼り付けるだけで登録できます</small>
          </div>
        </div>
        <AddAccountForm />
      </section>

      {accounts.length === 0 ? (
        <section className="card">
          <div className="card-head">
            <div className="card-title">✦ 連携済みの名義</div>
          </div>
          <div className="stat-note">
            まだありません。上の欄にトークンを貼り付けて追加してください。
          </div>
        </section>
      ) : (
        // 担当者ごとにカードを分ける。どれが誰の名義かをひと目で分かるようにする
        groups.map((g) => (
          <section className="card" key={g.group}>
            <div className="card-head">
              <div className="card-title">
                ✦ {groups.length > 1 ? g.label : '連携済みの名義'}{' '}
                <small>{g.accounts.length}件</small>
              </div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>名義</th>
                  <th style={{ width: 110 }}>トークン期限</th>
                  <th style={{ width: 130 }}>Persona</th>
                  <th style={{ width: 150 }}>担当</th>
                  <th style={{ width: 320 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {g.accounts.map((a) => (
                  <AccountRow
                    key={a.id}
                    account={a}
                    days={daysUntil(a.tokenExpiresAt)}
                    isAdmin={isAdmin}
                  />
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            ✦ Persona <small>{personas.length}件</small>
          </div>
        </div>
        {personas.length === 0 ? (
          <div className="stat-note">Persona が未登録です。</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>名前</th>
                <th>本数 / 時間帯</th>
                <th>間隔</th>
              </tr>
            </thead>
            <tbody>
              {personas.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.name}
                    <div className="post-slot">
                      <code>{p.id}</code>
                    </div>
                  </td>
                  <td>
                    {p.postsPerDay ?? '-'}本 / {p.activeWindow ?? '-'}
                  </td>
                  <td>{p.minGap ? `${p.minGap}分` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {isAdmin && credit && (
        <section className="card">
          <div className="card-head">
            <div className="card-title">
              ✦ Anthropic の残高 <small>投稿文の生成に使います</small>
            </div>
            {credit.configured && (
              <span className="badge" data-tone={credit.tone}>
                残り {usd(credit.remaining)}
                {credit.daysLeft !== null ? ` ・約${Math.floor(credit.daysLeft)}日ぶん` : ''}
              </span>
            )}
          </div>

          <p className="stat-note" style={{ marginTop: 0 }}>
            残高を取得できるAPIが無いため、
            <a href="https://platform.claude.com/settings/billing" target="_blank" rel="noreferrer">
              Claude Console の請求ページ
            </a>
            で見た額をここに入れてください。以降は生成ごとのトークン数から消費を数えて、
            残り{WARN_DAYS}日を切ったら全体状況に警告を出します。
          </p>

          <CreditForm credit={credit.credit} />

          {credit.configured && (
            <table style={{ marginTop: 14 }}>
              <tbody>
                <tr>
                  <td>記録した残高</td>
                  <td>
                    {usd(credit.credit)}（{new Date(credit.setAt).toLocaleString('ja-JP')}）
                  </td>
                </tr>
                <tr>
                  <td>それからの消費</td>
                  <td>{usd(credit.spent)}</td>
                </tr>
                <tr>
                  <td>1日あたり</td>
                  <td>{usd(credit.perDay)}</td>
                </tr>
                <tr>
                  <td>残り</td>
                  <td>
                    <strong>{usd(credit.remaining)}</strong>
                    {credit.daysLeft !== null && ` ・ 約${Math.floor(credit.daysLeft)}日ぶん`}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </section>
      )}

      {isAdmin && (
        <section className="card">
          <div className="card-head">
            <div className="card-title">
              ✦ 接続情報 <small>値は表示しません。設定の有無のみ確認できます。</small>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>項目</th>
                <th>環境変数</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {envStatus().map((e) => (
                <tr key={e.key}>
                  <td>{e.label}</td>
                  <td>
                    <code>{e.key}</code>
                  </td>
                  <td>
                    <span className="badge" data-tone={e.set ? 'ok' : 'danger'}>
                      {e.note ?? (e.set ? '設定済み' : '未設定')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
