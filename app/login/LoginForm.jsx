'use client';

import { useActionState } from 'react';
import { login } from '../_actions/auth';
import SubmitButton from '../_components/SubmitButton';

const initial = { error: null };

export default function LoginForm({ next }) {
  const [state, action] = useActionState(async (_prev, formData) => login(formData), initial);

  return (
    <form action={action} className="login-form">
      <input type="hidden" name="next" value={next ?? ''} />

      <label className="field">
        <span>ID</span>
        <input name="name" autoComplete="username" autoFocus required />
      </label>

      <label className="field">
        <span>パスワード</span>
        <input name="password" type="password" autoComplete="current-password" required />
      </label>

      {state?.error && <div className="login-error">{state.error}</div>}

      <SubmitButton className="btn btn-primary login-submit" pendingLabel="確認中…">
        ログイン
      </SubmitButton>
    </form>
  );
}
