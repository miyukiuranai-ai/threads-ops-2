'use client';

import { useActionState } from 'react';
import { deletePersona } from '../_actions/personas';
import SubmitButton from '../_components/SubmitButton';

/** 未使用のキャラ設定を消す（threads-ops2 で追加）。確認してから送る。 */
export default function DeletePersonaForm({ personaId, name }) {
  const [state, action] = useActionState(async (_prev, formData) => (await deletePersona(formData)) ?? null, null);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`キャラ設定「${name}」を削除します。取り消せません。よろしいですか？`)) e.preventDefault();
      }}
      style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--line)' }}
    >
      <input type="hidden" name="personaId" value={personaId} />
      <p className="stat-note" style={{ marginTop: 0 }}>
        どの名義にも使われていないキャラ設定は、ここから削除できます。
      </p>
      {state?.error && <p className="login-error">{state.error}</p>}
      <SubmitButton className="btn btn-reject" pendingLabel="削除中…">このキャラ設定を削除</SubmitButton>
    </form>
  );
}
