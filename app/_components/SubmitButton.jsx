'use client';
import { useFormStatus } from 'react-dom';

export default function SubmitButton({ children, className = '', confirm, ...rest }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      onClick={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}
      {...rest}
    >
      {pending ? '…' : children}
    </button>
  );
}
