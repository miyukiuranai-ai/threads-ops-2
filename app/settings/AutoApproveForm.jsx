'use client';

import { useActionState } from 'react';
import { setAutoApprove } from '../_actions/settings';
import SubmitButton from '../_components/SubmitButton';

const initial = { ok: null, error: null };

/**
 * 生成した投稿案を自動で承認するかどうかの切り替え（threads-ops2 で追加）。
 * 押した時点の状態を反転させる。取り違えを防ぐため、ON にするときは確認する。
 */
export default function AutoApproveForm({ on, postingLive }) {
  const [state, action] = useActionState(async (_prev, formData) => setAutoApprove(formData), initial);

  return (
    <form
      action={action}
      className="schedule-form"
      style={{ marginTop: 0 }}
      onSubmit={(e) => {
        if (!on && postingLive && !window.confirm('自動承認を ON にすると、人が見ないまま Threads へ投稿されます。よろしいですか？')) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="autoApprove" value={on ? 'off' : 'on'} />
      <span className="badge" data-tone={on ? 'ok' : 'default'}>{on ? 'ON' : 'OFF'}</span>
      <SubmitButton className={on ? 'btn' : 'btn btn-primary'} pendingLabel="保存中…">
        {on ? '自動承認を OFF にする' : '自動承認を ON にする'}
      </SubmitButton>
      {state?.error && <span className="over">{state.error}</span>}
      {state?.ok && <span style={{ color: 'var(--ok)', fontWeight: 700 }}>{state.ok}</span>}
    </form>
  );
}
