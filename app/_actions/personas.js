'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireSession, assertAccountVisible } from '../_lib/session';
import { savePersona, updateAccount, linesToArray, toBool, PERSONA_DEFAULTS, getAccount } from '@/lib/server/accounts.mjs';
import { canSeeAccount } from '@/lib/server/auth.mjs';

const ARRAY_FIELDS = ['styleRules', 'ngWords', 'bands', 'dayTypes', 'postingSlots', 'dayMix'];
const BOOL_FIELDS = ['reuseWinners', 'useDayPatterns', 'buzzTrial', 'slumpBuzz', 'autoDeleteFlops', 'hasAudience', 'perPostSwitch', 'noSuperBuzz'];
const NUM_FIELDS = ['slumpPosts', 'superBuzzAfterDays', 'superBuzzOnlyAfterDays'];
const TEXT_FIELDS = ['name', 'characterDoc', 'postsPerDay', 'minGap', 'activeWindow', 'nightAnchor', 'nightType', 'imagePolicy', 'model', 'askPerDay', 'winnersFrom', 'winnersTo', 'buzzTone', 'slumpType', 'lineUrl'];

export async function savePersonaAction(formData) {
  const session = await requireSession();
  const id = String(formData.get('id') || '');
  const accountId = String(formData.get('accountId') || '');
  if (accountId) await assertAccountVisible(session, accountId);
  else if (id && session.role !== 'admin') {
    // メンバーは自分の名義に紐づく Persona だけ
    const { listAccountsForSession } = await import('@/lib/server/accounts.mjs');
    const mine = await listAccountsForSession(session);
    if (!mine.some((a) => a.personaId === id)) throw new Error('この設定は操作できません');
  }
  const data = {};
  for (const f of TEXT_FIELDS) if (formData.has(f)) data[f] = String(formData.get(f) || '').trim();
  for (const f of ARRAY_FIELDS) if (formData.has(f)) data[f] = linesToArray(formData.get(f));
  for (const f of BOOL_FIELDS) data[f] = toBool(formData.get(f));
  for (const f of NUM_FIELDS) if (formData.has(f)) data[f] = Number(formData.get(f)) || PERSONA_DEFAULTS[f];
  const saved = await savePersona(id || null, data);
  if (accountId) {
    const acc = await getAccount(accountId);
    if (acc && acc.personaId !== saved.id) await updateAccount(accountId, { personaId: saved.id });
  }
  revalidatePath('/personas');
  redirect(`/personas/${encodeURIComponent(saved.id)}`);
}

export async function linkPersonaAction(formData) {
  const session = await requireSession();
  const accountId = String(formData.get('accountId') || '');
  const personaId = String(formData.get('personaId') || '');
  const acc = await assertAccountVisible(session, accountId);
  if (!canSeeAccount(session, acc)) throw new Error('操作できません');
  await updateAccount(accountId, { personaId });
  revalidatePath('/personas');
}
