// ツールの中の「相談」の入口。
// GET: 共有の会話を返す（画面が数秒ごとに読む）
// POST: ひとこと送って返事をもらう（Claude の呼び出しに数十秒かかるので API にしている）
import { getCurrentUser, filterAccountsForUser } from '@/lib/server/auth.mjs';
import { listAccounts } from '@/lib/server/repo.mjs';
import { ask, loadMessages } from '@/lib/server/chat.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET() {
  const user = await getCurrentUser();
  if (!user?.name) return Response.json({ error: 'ログインが必要です。' }, { status: 401 });
  const messages = await loadMessages({ limit: 80 });
  return Response.json({ messages });
}

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user?.name) return Response.json({ error: 'ログインが必要です。' }, { status: 401 });

  let body = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '内容を読めませんでした。' }, { status: 400 });
  }
  const text = String(body?.text ?? '').trim();
  if (!text) return Response.json({ error: '本文が空です。' }, { status: 400 });
  if ([...text].length > 4000) return Response.json({ error: '一度に送れるのは4000文字までです。' }, { status: 400 });

  try {
    const accounts = filterAccountsForUser(await listAccounts(), user);
    const reply = await ask({ text, name: user.name, model: body?.model, ctx: { user, accounts } });
    return Response.json({ ok: true, reply });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
