'use client';

import { useActionState } from 'react';
import { addWatch } from '../_actions/watchlist';
import SubmitButton from '../_components/SubmitButton';

const initial = { ok: null, error: null };

export default function WatchlistForm() {
  const [state, action] = useActionState(async (_prev, formData) => addWatch(formData), initial);

  return (
    <form action={action} className="schedule-form" style={{ marginTop: 0, flexWrap: 'wrap' }}>
      <label style={{ flex: '1 1 300px' }}>
        URL または @名前
        <input
          name="url"
          placeholder="https://www.threads.com/@senka_sendai_uranai"
          style={{ width: '100%' }}
          required
        />
      </label>
      <label style={{ flex: '1 1 200px' }}>
        メモ
        <input name="note" placeholder="例: 仙台・LINE誘導・絵文字コメント" style={{ width: '100%' }} />
      </label>
      <SubmitButton className="btn btn-primary" pendingLabel="控え中…">
        控える
      </SubmitButton>
      {state?.error && <span className="over">{state.error}</span>}
      {state?.ok && <span style={{ color: 'var(--ok)', fontWeight: 700 }}>{state.ok}</span>}
    </form>
  );
}
