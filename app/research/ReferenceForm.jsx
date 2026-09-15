'use client';

import { useActionState } from 'react';
import { addReferences } from '../_actions/references';
import SubmitButton from '../_components/SubmitButton';

const initial = { ok: null, error: null };

export default function ReferenceForm({ typeOptions }) {
  const [state, action] = useActionState(
    async (_prev, formData) => addReferences(formData),
    initial
  );

  return (
    <form action={action}>
      <div className="field-grid">
        <label className="field">
          <span>どの型のお手本か</span>
          <select name="category" defaultValue="attract_intro">
            {typeOptions.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}（{t.key}）
              </option>
            ))}
          </select>
          <small>選んだ型の投稿を作るときに、この本文が教材として渡ります。</small>
        </label>

        <label className="field">
          <span>メモ（任意）</span>
          <input name="note" placeholder="例: 深夜に伸びていた / コメントが多い" />
          <small>どこが良いと思ったかを残せます。</small>
        </label>
      </div>

      <label className="field">
        <span>投稿の本文</span>
        <textarea
          name="text"
          className="editor"
          rows={12}
          placeholder={'見つけた投稿をそのまま貼り付けてください。\n\n\n2本以上まとめて入れるときは、このように空行を2つで区切ります。'}
          required
        />
        <small>
          <strong>構造だけを教材にします。</strong>語彙や言い回しはそのまま使いません
          （同じ文が出回ると、どちらも伸びなくなるためです）。
        </small>
      </label>

      <div className="editor-foot">
        <span>
          {state?.error && <span className="over">{state.error}</span>}
          {state?.ok && <span style={{ color: 'var(--ok)', fontWeight: 700 }}>{state.ok}</span>}
        </span>
        <SubmitButton className="btn btn-primary" pendingLabel="登録中…">
          お手本として登録
        </SubmitButton>
      </div>
    </form>
  );
}
