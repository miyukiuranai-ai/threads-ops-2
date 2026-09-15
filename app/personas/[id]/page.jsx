import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { listAccounts, listPersonas } from '@/lib/server/repo.mjs';
import { getCurrentUser, filterAccountsForUser } from '@/lib/server/auth.mjs';
import { POST_TYPES } from '@/lib/server/generate.mjs';
import { MODELS } from '@/lib/server/claude.mjs';
import PersonaForm from '../PersonaForm';
import DeletePersonaForm from '../DeletePersonaForm';

export const dynamic = 'force-dynamic';

const typeOptions = Object.entries(POST_TYPES).map(([key, def]) => ({ key, label: def.label }));
const modelOptions = Object.entries(MODELS).map(([key, def]) => ({ key, label: def.label }));

export default async function PersonaEditPage({ params, searchParams }) {
  const { id } = await params;
  const query = await searchParams;

  const user = await getCurrentUser();
  const [allAccounts, allPersonas] = await Promise.all([listAccounts(), listPersonas()]);
  const accounts = filterAccountsForUser(allAccounts, user);
  const visible = new Set(accounts.map((a) => a.personaId).filter(Boolean));

  // 新規作成。どの名義に紐づけるかをクエリで受け取る
  if (id === 'new') {
    const account = accounts.find((a) => a.id === (query?.account ?? ''));
    if (!account) notFound();

    return (
      <Page title={`@${account.name} のキャラ設定`} desc="作成すると、この名義に自動で紐づきます。">
        <PersonaForm account={account} typeOptions={typeOptions} modelOptions={modelOptions} />
      </Page>
    );
  }

  const persona = allPersonas.find((p) => p.id === id);
  if (!persona) {
    // 名義がこの ID を指しているのに実体が無い（旧データの名残）→ 新規作成へ
    const orphan = accounts.find((a) => a.personaId === id);
    if (orphan) redirect(`/personas/new?account=${orphan.id}`);
    notFound();
  }
  if (user.role !== 'admin' && !visible.has(persona.id)) notFound();

  const used = accounts.filter((a) => a.personaId === persona.id);

  return (
    <Page
      title={persona.name}
      desc={used.length ? `使っている名義: ${used.map((a) => `@${a.name}`).join(', ')}` : 'まだどの名義にも使われていません。'}
    >
      <PersonaForm persona={persona} typeOptions={typeOptions} modelOptions={modelOptions} />
      {used.length === 0 && <DeletePersonaForm personaId={persona.id} name={persona.name} />}
    </Page>
  );
}

function Page({ title, desc, children }) {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          <p className="page-desc">{desc}</p>
        </div>
        <Link className="btn" href="/personas">
          一覧へ戻る
        </Link>
      </div>
      <section className="card">{children}</section>
    </>
  );
}
