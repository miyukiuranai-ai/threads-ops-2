'use client';

import { useState, useActionState } from 'react';
import {
  setAccountStatus,
  setAutoReply,
  setAutoReviewExempt,
  setAccountGroup,
  removeAccount,
} from '../_actions/accounts';
import SubmitButton from '../_components/SubmitButton';

const initial = { ok: null, error: null };

export default function AccountRow({ account, days, isAdmin }) {
  const tone = days === null ? 'warn' : days < 0 ? 'danger' : days < 10 ? 'warn' : 'ok';
  const active = (account.status ?? 'active') === 'active';

  const [confirming, setConfirming] = useState(false);
  const [removeState, remove] = useActionState(
    async (_prev, formData) => removeAccount(formData),
    initial
  );

  return (
    <tr>
      <td>
        <strong>@{account.name}</strong>
        <div className="post-slot">
          <code>{account.threadsUserId}</code>
        </div>
      </td>

      <td>
        <span className="badge" data-tone={tone}>
          {days === null ? '不明' : `残り${days}日`}
        </span>
      </td>

      <td>
        {account.personaId ? (
          <a className="btn" href={`/personas/${account.personaId}`}>
            編集
          </a>
        ) : (
          <a className="btn btn-primary" href={`/personas/new?account=${account.id}`}>
            設定する
          </a>
        )}
        {account.personaId && <div className="post-slot">{account.personaId}</div>}
      </td>

      <td>
        {isAdmin ? (
          <form action={setAccountGroup} className="schedule-form" style={{ marginTop: 0 }}>
            <input type="hidden" name="accountId" value={account.id} />
            <input
              type="text"
              name="group"
              defaultValue={account.group ?? 'main'}
              style={{ width: 90 }}
            />
            <SubmitButton className="btn" pendingLabel="…">
              変更
            </SubmitButton>
          </form>
        ) : (
          (account.group ?? 'main')
        )}
      </td>

      <td>
        <div className="actions-row" style={{ flexWrap: 'wrap', gap: 4 }}>
          <form action={setAccountStatus}>
            <input type="hidden" name="accountId" value={account.id} />
            <input type="hidden" name="status" value={active ? 'paused' : 'active'} />
            <SubmitButton
              className={active ? 'btn btn-hold' : 'btn btn-approve'}
              pendingLabel="更新中…"
            >
              {active ? '稼働中 → 停止' : '停止中 → 稼働'}
            </SubmitButton>
          </form>

          <form action={setAutoReply}>
            <input type="hidden" name="accountId" value={account.id} />
            <input type="hidden" name="autoReply" value={account.autoReply ? 'off' : 'on'} />
            <SubmitButton className="btn" pendingLabel="更新中…">
              自動返信 {account.autoReply ? 'ON → OFF' : 'OFF → ON'}
            </SubmitButton>
          </form>

          <form action={setAutoReviewExempt}>
            <input type="hidden" name="accountId" value={account.id} />
            <input type="hidden" name="exempt" value={account.autoReviewExempt ? 'off' : 'on'} />
            <SubmitButton
              className="btn"
              pendingLabel="更新中…"
              title="ON のとき、23:30 を過ぎても承認待ちを自動で承認・却下しません（承認しない限り投稿されません）"
            >
              手動承認のみ {account.autoReviewExempt ? 'ON → OFF' : 'OFF → ON'}
            </SubmitButton>
          </form>

          <button type="button" className="btn" onClick={() => setConfirming((v) => !v)}>
            {confirming ? '取消' : '外す'}
          </button>
        </div>

        {confirming && (
          <form action={remove} className="remove-box">
            <input type="hidden" name="accountId" value={account.id} />
            <p>
              <strong>@{account.name} をツールから外します。</strong>
              <br />
              この名義の投稿案・コメント・投稿履歴・キャラ設定も消えます。元に戻せません。
              <br />
              Threads のアカウントと、すでに投稿された内容はそのまま残ります。
            </p>
            <div className="remove-row">
              <input
                name="confirm"
                placeholder={account.name}
                autoComplete="off"
                aria-label="確認のためユーザー名を入力"
              />
              <SubmitButton className="btn btn-reject" pendingLabel="削除中…">
                外す
              </SubmitButton>
            </div>
            <div className="remove-note">
              確認のため <code>{account.name}</code> と入力してください。
            </div>
          </form>
        )}

        {removeState.error && <div className="remove-note over">{removeState.error}</div>}
        {removeState.ok && (
          <div className="remove-note" style={{ color: 'var(--ok)', fontWeight: 700 }}>
            {removeState.ok}
          </div>
        )}
      </td>
    </tr>
  );
}
