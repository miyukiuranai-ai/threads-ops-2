'use client';

import { useActionState } from 'react';
import { addTestimonials } from '../_actions/testimonials';
import SubmitButton from '../_components/SubmitButton';

const initial = { ok: null, error: null };

/**
 * お客様の声（口コミ）を貼る欄。
 * 貼った声は、その名義の投稿にたまに1件ずつ「声を引く型」として使われる。
 */
export default function TestimonialForm({ accounts }) {
  const [state, action] = useActionState(async (_prev, formData) => addTestimonials(formData), initial);

  return (
    <form action={action}>
      <div className="field-grid">
        <label className="field">
          <span>どの名義の声か</span>
          <select name="accountId" defaultValue={accounts[0]?.id ?? ''}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                @{a.name}
              </option>
            ))}
          </select>
          <small>その名義の投稿にだけ使います。</small>
        </label>

        <label className="field">
          <span>メモ（任意）</span>
          <input name="note" placeholder="例: 復縁の相談 / 8月の鑑定" />
        </label>
      </div>

      <label className="field">
        <span>声の本文</span>
        <textarea
          name="text"
          className="editor"
          rows={6}
          placeholder={'いただいた言葉をそのまま貼ります。名前や特定できる情報は伏せてください。\n\n\n（2件以上は空行2つで区切ります）'}
          required
        />
        <small>
          画面写真しか無いときは、文字に起こして貼ってください。投稿では一部を「」で引用し、要約や脚色はしません。
          1件は1回しか使いません。
        </small>
      </label>

      <div className="editor-foot">
        <span>
          {state?.error && <span className="over">{state.error}</span>}
          {state?.ok && <span style={{ color: 'var(--ok)', fontWeight: 700 }}>{state.ok}</span>}
        </span>
        <SubmitButton className="btn" pendingLabel="登録中…">
          声を登録する
        </SubmitButton>
      </div>
    </form>
  );
}
