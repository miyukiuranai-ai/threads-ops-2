'use client';

import { useFormStatus } from 'react-dom';

/**
 * 送信中が分かるボタン。
 * 押した瞬間に無効化してラベルを変えるので、反応したかどうかが目で分かる。
 */
export default function SubmitButton({ className = 'btn', children, pendingLabel = '処理中…', disabled }) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className={className} disabled={pending || disabled} data-pending={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}
