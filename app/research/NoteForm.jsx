'use client';

import { useActionState } from 'react';
import { saveTomorrowNote } from '../_actions/directives';
import SubmitButton from '../_components/SubmitButton';

const initial = { ok: null, error: null };

/** 明日の日付（日本時間）。 */
function tomorrow() {
  return new Date(Date.now() + 9 * 3600000 + 86400000).toISOString().slice(0, 10);
}

const PRESETS = [
  { value: '', label: '（構成は変えない）' },
  { value: 'buzz_engagement, attract_intro', label: 'バズ1本＋属人1本' },
  { value: 'buzz_engagement, buzz_engagement, attract_intro', label: 'バズ2本＋属人1本' },
  { value: 'buzz_engagement, attract_intro, attract_intro', label: 'バズ1本＋属人2本' },
  { value: 'buzz_engagement, buzz_engagement', label: 'バズ2本' },
  { value: 'buzz_engagement, reading_open', label: 'バズ1本＋霊視開始1本' },
  { value: 'attract_intro', label: '属人1本' },
  { value: 'buzz_engagement, travel_note', label: 'バズ1本＋土地移動1本' },
  { value: 'travel_note, attract_intro', label: '土地移動1本＋属人1本' },
  { value: 'buzz_engagement', label: 'バズ1本' },
  { value: 'image_buzz, image_buzz', label: '超バズ特化2本（画像。雑魚の名義向け）' },
  { value: 'image_buzz, buzz_engagement', label: '超バズ特化1本＋バズ特化1本' },
];

/**
 * 「明日への指示」。レポートを読んで、名義ごとに構成と文章の指示を書いておく。
 * 15:30 の生成が読んで作るので、相談の費用はかからない。
 */
export default function NoteForm({ accounts, typeOptions }) {
  const [state, action] = useActionState(async (_prev, formData) => saveTomorrowNote(formData), initial);

  return (
    <form action={action}>
      <div className="field-grid">
        <label className="field">
          <span>名義</span>
          <select name="accountId" defaultValue={accounts[0]?.id ?? ''}>
            <option value="_all_">全名義に共通</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                @{a.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>対象日</span>
          <input type="date" name="date" defaultValue={tomorrow()} min={tomorrow()} />
          <small>ふつうは明日（15:30 に作るぶん）。</small>
        </label>

        <label className="field">
          <span>構成（任意）</span>
          <select name="types" defaultValue="">
            {PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <input name="typesText" placeholder="一覧に無ければここに。例: バズ2、属人2、霊視開始1" style={{ marginTop: 6 }} />
          <small>
            本数と型をこの日だけ指定します。下の欄に書けば、上の選択より優先します。
            使える語: 超バズ（画像）／バズ／属人（＝名乗り）／素の属人／寺社／土地移動／霊視開始／不安煽り。数字を付けなければ1本。
          </small>
        </label>
      </div>

      <label className="field">
        <span>指示の文章（任意）</span>
        <textarea
          name="instruction"
          className="editor"
          rows={4}
          placeholder={'例: 昨日のバズ型は伸びなかったので、今日は属人型を昨日の23時の骨格で。合図は🙏。暦は使わない。'}
        />
        <small>生成のときに「運用者からの指示」として最優先で渡します。あなたと suzuki のどちらが書いたかも記録されます。</small>
      </label>

      <div className="editor-foot">
        <span>
          {state?.error && <span className="over">{state.error}</span>}
          {state?.ok && <span style={{ color: 'var(--ok)', fontWeight: 700 }}>{state.ok}</span>}
        </span>
        <SubmitButton className="btn btn-primary" pendingLabel="保存中…">
          明日への指示を保存
        </SubmitButton>
      </div>
    </form>
  );
}
