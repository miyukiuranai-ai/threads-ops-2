'use client';

import { useActionState } from 'react';
import { savePersona } from '../_actions/personas';
import SubmitButton from '../_components/SubmitButton';

const initial = { ok: null, error: null };

/**
 * キャラ設定の入力欄。
 * ここで決めた内容がそのまま投稿文の材料になるので、
 * 何がどう使われるかを各項目の下に書いている。
 */
export default function PersonaForm({ persona, account, typeOptions, modelOptions = [] }) {
  const [state, action] = useActionState(async (_prev, formData) => savePersona(formData), initial);
  const p = persona ?? {};

  return (
    <form action={action} className="persona-form">
      {persona ? (
        <input type="hidden" name="personaId" value={persona.id} />
      ) : (
        <input type="hidden" name="accountId" value={account?.id ?? ''} />
      )}

      <div className="field-grid">
        <label className="field">
          <span>名前</span>
          <input name="name" defaultValue={p.name ?? ''} placeholder="玲月" required />
          <small>読み仮名は下の人物設定に書いてください。</small>
        </label>

        <label className="field">
          <span>1日の本数</span>
          <input name="postsPerDay" defaultValue={p.postsPerDay ?? '3-5'} placeholder="3-5" required />
          <small>「3-5」と書くと日によって3〜5本になります。</small>
        </label>

        <label className="field">
          <span>投稿する時間帯</span>
          <input
            name="activeWindow"
            defaultValue={p.activeWindow ?? '06:00-23:55'}
            placeholder="06:00-23:55"
            required
          />
          <small>この範囲のなかで毎日ちがう時刻に割り振ります。</small>
        </label>

        <label className="field">
          <span>最短の間隔（分）</span>
          <input name="minGap" defaultValue={p.minGap ?? '240-300'} placeholder="240-300" required />
          <small>投稿と投稿のあいだを最低これだけ空けます。240分＝4時間。</small>
        </label>

        <label className="field">
          <span>深夜の固定枠</span>
          <input name="nightAnchor" defaultValue={p.nightAnchor ?? ''} placeholder="23:00-23:55" />
          <small>集客が伸びる時間帯を1枠だけ固定します。空欄でも構いません。</small>
        </label>

        <label className="field">
          <span>深夜枠の型</span>
          <select name="nightType" defaultValue={p.nightType ?? 'attract_intro'}>
            <option value="">（使わない）</option>
            {typeOptions.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          <small>深夜の固定枠で使う型。属人型が集客に効きます。</small>
        </label>

        <label className="field">
          <span>1日の構成（いまの要望。空欄なら大元のルールどおり）</span>
          <input name="dayMix" defaultValue={(p.dayMix ?? []).join(', ')} placeholder="buzz_engagement, attract_intro" />
          <small>
            例: 「buzz_engagement, buzz_engagement, attract_intro」＝バズ型2本＋属人型1本。本数はこの数になり、
            バズ型は早い枠、属人型は遅い枠に入ります。分析しながらいつでも変えて構いません。
            入っているあいだは落ち込みの自動調整と構成の型より要望を優先します。1日だけ変えるならレポートの返事や相談から。
          </small>
        </label>

        <label className="field">
          <span>日中の型（カンマ区切り・順番に使います）</span>
          <input
            name="dayTypes"
            defaultValue={(p.dayTypes ?? ['exclusion_hook']).join(', ')}
            placeholder="exclusion_hook, exclusion_hook, attract_intro"
            required
          />
          <small>
            使える型: {typeOptions.map((t) => `${t.key}（${t.label}）`).join(' / ')}
          </small>
        </label>

        <label className="field">
          <span>画像の頻度</span>
          <select name="imagePolicy" defaultValue={p.imagePolicy ?? 'sometimes'}>
            <option value="never">使わない</option>
            <option value="rarely">まれに（週1〜2回）</option>
            <option value="sometimes">ときどき</option>
            <option value="often">よく使う</option>
          </select>
          <small>画像が要る投稿は、画像を入れるまで自動投稿されません。</small>
        </label>

        <label className="field">
          <span>文章を作るモデル</span>
          <select name="model" defaultValue={p.model ?? 'claude-opus-5'}>
            {modelOptions.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
          <small>
            属人型は言葉の密度が要るので高品質を、バズ特化など型が決まっている名義は標準で十分です。
          </small>
        </label>

        <label className="field">
          <span>合言葉を求める本数（1日）</span>
          <input name="askPerDay" defaultValue={p.askPerDay ?? ''} placeholder="2-3" />
          <small>
            「2-3」と書くと、前日が3本なら2本、2本なら3本と交互にします。
            残りの投稿は合言葉を求めない終わり方になります。空欄だと毎回求めます。
          </small>
        </label>

        <label className="field">
          <span>当たった投稿の骨格を使い回す</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" name="reuseWinners" defaultChecked={p.reuseWinners === true} style={{ width: 'auto' }} />
            <small style={{ margin: 0 }}>ON にすると、この名義でコメントといいねが多かった投稿の骨格をそのまま使い、
            変えるのは冒頭の呼びかけ・合言葉・季節の語だけになります。</small>
          </span>
          <small>手動で当たっている形がある名義向け。OFF だと毎回ちがう形を作ります。</small>
        </label>

        <label className="field">
          <span>1日の構成の型を使う</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" name="useDayPatterns" defaultChecked={p.useDayPatterns !== false} style={{ width: 'auto' }} />
            <small style={{ margin: 0 }}>ON だと「名乗りは深夜」「暦の日」「静かな日」などの並びを毎日変えて使います。
            当たっている名義は OFF にして、本来の投稿を続けて構いません。</small>
          </span>
        </label>

        <label className="field">
          <span>バズ狙いを1日1本入れる（試験）</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" name="buzzTrial" defaultChecked={p.buzzTrial === true} style={{ width: 'auto' }} />
            <small style={{ margin: 0 }}>ON だと、その日の枠のどれか1つ（最後の枠以外）をバズ型にします。反応を見る実験用です。</small>
          </span>
        </label>

        <label className="field">
          <span>落ち込み中は1本をバズ型にする</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" name="slumpBuzz" defaultChecked={p.slumpBuzz !== false} style={{ width: 'auto' }} />
            <small style={{ margin: 0 }}>表示が急に落ちた名義は自動で1日1本に絞ります。ON だとその1本をブーストの型にし、露出を取り戻しにいきます。</small>
          </span>
          <select name="slumpType" defaultValue={p.slumpType ?? 'buzz_engagement'} style={{ marginTop: 6 }}>
            <option value="buzz_engagement">バズ型（日付→いいねした人だけ→断定）</option>
            <option value="reading_open">霊視開始型（時刻→本名不要→真剣な人だけ→合図）</option>
          </select>
          <small>ブーストに使う型。霊視開始型はコメントが集まりやすく、落ち込み中の試験用です。</small>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <span>落ち込み中の本数</span>
            <select name="slumpPosts" defaultValue={String(p.slumpPosts ?? 1)} style={{ width: 'auto' }}>
              <option value="1">1本</option>
              <option value="2">2本（1本目をバズ型、2本目をブーストの型）</option>
              <option value="3">3本</option>
            </select>
          </span>
        </label>

        <label className="field">
          <span>伸びなかったバズ型を自動で消す</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" name="autoDeleteFlops" defaultChecked={p.autoDeleteFlops !== false} style={{ width: 'auto' }} />
            <small style={{ margin: 0 }}>ON だと、バズ型の投稿が24時間たっても「いいね0・コメント0」なら Threads から消します。属人型などは消しません。</small>
          </span>
        </label>

        <label className="field">
          <span>超バズ特化型を使わない</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" name="noSuperBuzz" defaultChecked={p.noSuperBuzz === true} style={{ width: 'auto' }} />
            <small style={{ margin: 0 }}>一度上がった名義（うた、星蘭）向け。落ち込んでも、レポートは超バズ特化型ではなくバズ特化型での立て直しを提案します。</small>
          </span>
        </label>

        <label className="field">
          <span>バズ型の強さ</span>
          <select name="buzzTone" defaultValue={p.buzzTone ?? 'normal'}>
            <option value="normal">通常（日付・時間帯・断定で押す）</option>
            <option value="light">ライト（挨拶、短い肯定、好きな絵文字。煽らない）</option>
          </select>
          <small>バズ型の枠をどこまで強く書くか。世界観を守りたい名義はライトにします。</small>
        </label>

        <label className="field">
          <span>手本にする期間（骨格を取る投稿の範囲）</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="date" name="winnersFrom" defaultValue={p.winnersFrom ?? ''} />
            〜
            <input type="date" name="winnersTo" defaultValue={p.winnersTo ?? ''} />
          </span>
          <small>
            「良かった」と判断した期間を入れると、その期間の自分の投稿を全部そのまま骨格にします。
            空欄だとコメントが多かった投稿から選びます。終わりは空欄でも構いません。
          </small>
        </label>

        <label className="field">
          <span>誘導先のURL</span>
          <input name="lineUrl" defaultValue={p.lineUrl ?? ''} placeholder="空欄可" />
          <small>本文には出しません。返信の文面で使う場合だけ入れてください。</small>
        </label>

        <label className="field">
          <span>固定の投稿時刻（カンマ区切り）</span>
          <input
            name="postingSlots"
            defaultValue={(p.postingSlots ?? []).join(', ')}
            placeholder="空欄推奨"
          />
          <small>
            入れると毎日その時刻に固定されます。<strong>空欄のほうが安全です</strong>（毎日ずらすため）。
          </small>
        </label>
      </div>

      <label className="field">
        <span>時間帯ごとの投稿枠（1行に1つ・1つの帯につき1本）</span>
        <textarea
          name="bands"
          className="editor"
          rows={5}
          defaultValue={(p.bands ?? []).join('\n')}
          placeholder={
            '00:00-05:00 attract_intro 70%\n05:00-09:00 90%\n12:00-17:00 65%\n17:00-20:00 80%\n20:30-23:50 90%'
          }
        />
        <small>
          <code>時間帯 [型] [出現率%]</code> の形で書きます。型と出現率は省けます。
          「21:00-01:00」のように日付をまたぐ帯も書けます（翌日の1時までに1本）。
          書くと、上の「投稿する時間帯」「深夜の固定枠」より優先されます。
          <br />
          帯ごとに1本ずつ置き、隣り合う投稿は必ず上の「最短の間隔」を空けます。
          <strong>出現率はその帯を使う日の割合</strong>で、70%なら10日に7日です。
          毎日同じ帯に出ると癖になるので、深夜は下げておくと自然になります。
          <br />
          本数が「1日の本数」に収まらない日は、出現率の低い帯から外し、高い帯から戻します。
          間隔を空けられない帯はその日だけ使いません（詰め込みません）。
        </small>
      </label>

      <label className="field">
        <span>書き方のきまり（1行に1つ）</span>
        <textarea
          name="styleRules"
          className="editor"
          rows={6}
          defaultValue={(p.styleRules ?? []).join('\n')}
          placeholder={'1行を短く保ち、こまめに改行する\n敬体で、静かに整った言葉を選ぶ\n絵文字は行末に1つまで'}
        />
      </label>

      <label className="field">
        <span>言わないこと（1行に1つ）</span>
        <textarea
          name="ngWords"
          className="editor"
          rows={5}
          defaultValue={(p.ngWords ?? []).join('\n')}
          placeholder={'必ず儲かる\n病気が治る\n医療や投資の助言\n他者を貶す表現'}
        />
      </label>

      <label className="field">
        <span>人物設定</span>
        <textarea
          name="characterDoc"
          className="editor"
          rows={18}
          defaultValue={p.characterDoc ?? ''}
          placeholder={
            '# 人物\n地名、名乗り（読み仮名つき）、霊視歴、視える範囲を書きます。\n\n# 土地\nその土地の由緒。ここが世界観の芯になります。\n\n# 語り口\n避けたい空気感も書いてください。'
          }
          required
        />
        <small>
          ここが投稿文の芯になります。<strong>地名は他の名義と重ねない</strong>でください。
          世界観が重なると、同じ運営者だと分かりやすくなります。
        </small>
      </label>

      <div className="editor-foot">
        <span>
          {state?.error && <span className="over">{state.error}</span>}
          {state?.ok && <span style={{ color: 'var(--ok)', fontWeight: 700 }}>{state.ok}</span>}
        </span>
        <SubmitButton className="btn btn-primary" pendingLabel="保存中…">
          {persona ? '保存' : '作成して名義に紐づける'}
        </SubmitButton>
      </div>
    </form>
  );
}
