'use client';

import { useActionState } from 'react';
import { setAnthropicCredit } from '../_actions/settings';
import SubmitButton from '../_components/SubmitButton';

const initial = { ok: null, error: null };

export default function CreditForm({ credit }) {
  const [state, action] = useActionState(
    async (_prev, formData) => setAnthropicCredit(formData),
    initial
  );

  return (
    <form action={action} className="schedule-form" style={{ marginTop: 0 }}>
      <label>
        いまの残高（USD）
        <input name="credit" defaultValue={credit ?? ''} placeholder="20" style={{ width: 90 }} />
      </label>
      <SubmitButton className="btn btn-primary" pendingLabel="保存中…">
        記録する
      </SubmitButton>
      {state?.error && <span className="over">{state.error}</span>}
      {state?.ok && <span style={{ color: 'var(--ok)', fontWeight: 700 }}>{state.ok}</span>}
    </form>
  );
}
