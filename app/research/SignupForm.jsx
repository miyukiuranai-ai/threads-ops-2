'use client';

import { useActionState, useState } from 'react';
import { saveSignups } from '../_actions/signups';
import SubmitButton from '../_components/SubmitButton';

const initial = { ok: null, error: null };

/**
 * 前日の日付（日本時間）。
 * LINE の管理画面は1日遅れで確定するので、入れるのはいつも昨日のぶんになる。
 */
function yesterday() {
  const jst = new Date(Date.now() + 9 * 3600000 - 86400000);
  return jst.toISOString().slice(0, 10);
}

/**
 * LINE の友だち追加数の入力。
 * 名義が増えると1件ずつでは手間なので、その日のぶんをまとめて入れる。
 *
 * 選んだ日付にすでに記録があれば、その値を欄に出す（見たまま直せる）。
 * 空欄の名義は触らない（うっかり0で上書きしないため）。
 *
 * @param {{ accounts: object[], existing: Record<string, number> }} props
 *   existing は「名義ID_日付」→ 人数
 */
export default function SignupForm({ accounts, existing = {} }) {
  const [state, action] = useActionState(async (_prev, formData) => saveSignups(formData), initial);
  const [date, setDate] = useState(yesterday());
  const [values, setValues] = useState(() => pick(existing, accounts, yesterday()));

  function onDateChange(next) {
    setDate(next);
    setValues(pick(existing, accounts, next));
  }

  return (
    <form action={action}>
      <div className="schedule-form" style={{ marginTop: 0 }}>
        <label>
          日付
          <input type="date" name="date" value={date} onChange={(e) => onDateChange(e.target.value)} />
        </label>
        <span className="stat-note">
          その日に増えた人数を入れてください（総数ではありません）。LINE は1日遅れなので、昨日のぶんが基本です。
        </span>
      </div>

      <div className="signup-grid">
        {accounts.map((a) => (
          <label className="signup-cell" key={a.id} data-recorded={values[a.id] !== ''}>
            <span>@{a.name}</span>
            <input
              name={`count_${a.id}`}
              inputMode="numeric"
              placeholder="—"
              autoComplete="off"
              value={values[a.id] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [a.id]: e.target.value }))}
            />
          </label>
        ))}
      </div>

      <div className="editor-foot">
        <span>
          {state?.error && <span className="over">{state.error}</span>}
          {state?.ok && <span style={{ color: 'var(--ok)', fontWeight: 700 }}>{state.ok}</span>}
          {!state?.error && !state?.ok && '数字が入っている欄は記録済みです。空欄の名義は変更しません。'}
        </span>
        <SubmitButton className="btn btn-primary" pendingLabel="保存中…">
          まとめて記録する
        </SubmitButton>
      </div>
    </form>
  );
}

/** その日付の記録済みの値を、名義ごとに取り出す。無ければ空文字。 */
function pick(existing, accounts, date) {
  const out = {};
  for (const a of accounts) {
    const v = existing[`${a.id}_${date}`];
    out[a.id] = v === undefined || v === null ? '' : String(v);
  }
  return out;
}
