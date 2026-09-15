'use client';

import { useActionState } from 'react';
import { addAccount } from '../_actions/accounts';
import SubmitButton from '../_components/SubmitButton';

const initial = { ok: null, error: null };

export default function AddAccountForm() {
  const [state, action] = useActionState(async (_prev, formData) => addAccount(formData), initial);

  return (
    <form action={action}>
      <p className="stat-note" style={{ marginTop: 0, marginBottom: 10 }}>
        Meta の「ユーザートークン生成ツール」で発行した長期アクセストークンを貼り付けてください。
        持ち主を確認して登録します。登録直後は<strong>停止中</strong>なので、投稿されることはありません。
      </p>

      <textarea
        name="accessToken"
        className="editor"
        rows={3}
        placeholder="THAAX... で始まる長いトークンを貼り付け"
        required
      />

      <div className="editor-foot">
        <span>
          {state.error && <span className="over">{state.error}</span>}
          {state.ok && <span style={{ color: 'var(--ok)', fontWeight: 700 }}>{state.ok}</span>}
        </span>
        <SubmitButton className="btn btn-primary" pendingLabel="確認中…">
          名義を追加
        </SubmitButton>
      </div>
    </form>
  );
}
