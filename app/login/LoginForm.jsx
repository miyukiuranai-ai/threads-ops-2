'use client';
import { useActionState } from 'react';
import { loginAction } from '../_actions/auth';

export default function LoginForm({ next }) {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="next" value={next} />
      <label>ID</label>
      <input name="user" autoComplete="username" required />
      <label>パスワード</label>
      <input name="password" type="password" autoComplete="current-password" required />
      {state?.error && <p className="error">{state.error}</p>}
      <p><button type="submit" disabled={pending}>{pending ? '…' : 'ログイン'}</button></p>
    </form>
  );
}
