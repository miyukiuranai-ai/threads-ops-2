import { pageContext } from '../../_lib/session';
import { getPersona, PERSONA_DEFAULTS } from '@/lib/server/accounts.mjs';
import { TYPE_KEYS, POST_TYPES } from '@/lib/server/post-types.mjs';
import { MODELS } from '@/lib/server/ai.mjs';
import { savePersonaAction } from '../../_actions/personas';
import SubmitButton from '../../_components/SubmitButton';

export const dynamic = 'force-dynamic';

export default async function PersonaEditPage({ params, searchParams }) {
  const { session, accounts, sp } = await pageContext(searchParams);
  const { id } = await params;
  const isNew = id === 'new';
  const persona = isNew ? { ...PERSONA_DEFAULTS } : await getPersona(decodeURIComponent(id));
  if (!persona) return <div><h1>キャラ設定</h1><p className="error">見つかりません</p></div>;
  if (!isNew && session.role !== 'admin' && !accounts.some((a) => a.personaId === persona.id)) return <div><h1>キャラ設定</h1><p className="error">この設定は見られません</p></div>;
  const accountId = typeof sp.account === 'string' ? sp.account : '';
  const linked = accounts.filter((a) => a.personaId === persona.id);
  const arr = (v) => (v || []).join('\n');
  const Check = ({ name, label, note }) => (
    <label className="inline" style={{ marginRight: 14 }}><input type="checkbox" name={name} defaultChecked={Boolean(persona[name])} /> {label}{note && <small className="muted">（{note}）</small>}</label>
  );
  return (
    <div>
      <h1>{isNew ? 'キャラ設定を作る' : `キャラ設定: ${persona.name || persona.id}`}</h1>
      {linked.length > 0 && <p className="muted">紐づく名義: {linked.map((a) => `@${a.name}`).join(', ')}</p>}
      <form action={savePersonaAction} className="stack">
        <input type="hidden" name="id" value={isNew ? '' : persona.id} />
        <input type="hidden" name="accountId" value={accountId} />
        <div className="card">
          <label>表示名（例: 星蘭）</label><input name="name" defaultValue={persona.name} required />
          <label>人物設定 characterDoc（土地、名乗り、視えるもの、語り口。生成の芯）</label>
          <textarea name="characterDoc" className="body" defaultValue={persona.characterDoc} />
          <div className="row">
            <span style={{ flex: 1 }}><label>書き方のきまり styleRules（1行1つ）</label><textarea name="styleRules" defaultValue={arr(persona.styleRules)} /></span>
            <span style={{ flex: 1 }}><label>言わないこと ngWords（1行1つ）</label><textarea name="ngWords" defaultValue={arr(persona.ngWords)} /></span>
          </div>
          <label>返信の誘導先 lineUrl</label><input name="lineUrl" defaultValue={persona.lineUrl} />
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>本数と時間帯</h2>
          <div className="row">
            <span><label>postsPerDay（"3" か "2-5"）</label><input name="postsPerDay" defaultValue={persona.postsPerDay} /></span>
            <span><label>minGap 最短の間隔（分）"180-300"</label><input name="minGap" defaultValue={persona.minGap} /></span>
            <span><label>askPerDay 合言葉を指定する本数 "2-3"</label><input name="askPerDay" defaultValue={persona.askPerDay} /></span>
            <span><label>activeWindow（帯を使わないとき）</label><input name="activeWindow" defaultValue={persona.activeWindow} /></span>
          </div>
          <label>bands 時間帯の枠（1行1つ。HH:MM-HH:MM [型] [NN%]。21:00-01:00 も可）</label>
          <textarea name="bands" defaultValue={arr(persona.bands)} />
          <div className="row">
            <span style={{ flex: 1 }}><label>dayTypes（帯に型が無いときの型、1行1つ）</label><textarea name="dayTypes" defaultValue={arr(persona.dayTypes)} /></span>
            <span style={{ flex: 1 }}><label>postingSlots（旧方式の固定枠 HH:MM、1行1つ）</label><textarea name="postingSlots" defaultValue={arr(persona.postingSlots)} /></span>
          </div>
          <div className="row">
            <span><label>nightAnchor（旧）</label><input name="nightAnchor" defaultValue={persona.nightAnchor} /></span>
            <span><label>nightType（旧）</label><input name="nightType" defaultValue={persona.nightType} /></span>
          </div>
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>構成と型</h2>
          <label>dayMix いまの要望の構成（1行1つ。比率として繰り返す。例: buzz_engagement / attract_intro）</label>
          <textarea name="dayMix" defaultValue={arr(persona.dayMix)} placeholder={TYPE_KEYS.join('\n')} />
          <p className="muted">型キー: {TYPE_KEYS.map((k) => `${k}（${POST_TYPES[k].name}）`).join('、')}</p>
          <div className="row">
            <Check name="useDayPatterns" label="1日の構成の型を回す" />
            <Check name="buzzTrial" label="バズ狙いを1日1本" />
            <span><label>buzzTone</label><select name="buzzTone" defaultValue={persona.buzzTone}><option value="normal">normal</option><option value="light">light（煽らない）</option></select></span>
          </div>
          <div className="row">
            <Check name="reuseWinners" label="当たった投稿の骨格を使い回す" />
            <span><label>winnersFrom</label><input name="winnersFrom" type="date" defaultValue={persona.winnersFrom} /></span>
            <span><label>winnersTo</label><input name="winnersTo" type="date" defaultValue={persona.winnersTo} /></span>
          </div>
          <div className="row">
            <Check name="slumpBuzz" label="落ち込み中に本数を絞る" />
            <span><label>slumpPosts</label><input name="slumpPosts" type="number" defaultValue={persona.slumpPosts} /></span>
            <span><label>slumpType</label><select name="slumpType" defaultValue={persona.slumpType}><option value="buzz_engagement">buzz_engagement</option><option value="reading_open">reading_open</option></select></span>
            <Check name="autoDeleteFlops" label="24時間で反応0のバズ型を消す" />
          </div>
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>超バズと切り替え</h2>
          <div className="row">
            <Check name="hasAudience" label="集客が来ている（超バズだけにしない）" />
            <Check name="noSuperBuzz" label="超バズを使わない" />
            <Check name="perPostSwitch" label="投稿ごとの切り替え" />
          </div>
          <div className="row">
            <span><label>superBuzzAfterDays（集客あり: 1,000未満が続く日数で超バズを1本挟む）</label><input name="superBuzzAfterDays" type="number" defaultValue={persona.superBuzzAfterDays} /></span>
            <span><label>superBuzzOnlyAfterDays（集客なし: 300未満が続く日数で超バズだけ。0 で止める）</label><input name="superBuzzOnlyAfterDays" type="number" defaultValue={persona.superBuzzOnlyAfterDays} /></span>
          </div>
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>画像と生成</h2>
          <div className="row">
            <span><label>imagePolicy</label><select name="imagePolicy" defaultValue={persona.imagePolicy}>{['never', 'rarely', 'sometimes', 'often'].map((v) => <option key={v}>{v}</option>)}</select></span>
            <span><label>model</label><select name="model" defaultValue={persona.model}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select></span>
          </div>
        </div>
        <SubmitButton>保存</SubmitButton>
      </form>
    </div>
  );
}
