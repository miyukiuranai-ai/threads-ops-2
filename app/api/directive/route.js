// レポートの提案に返事をするためのエンドポイント。
// 指示（休む／1本／1本バズ／2本／そのまま）を保存し、その日ぶんの下書きを作り直す。
// 生成に30〜60秒かかるので、サーバーアクションではなく API にしている。
import { getCurrentUser, filterAccountsForUser } from '@/lib/server/auth.mjs';
import { listAccounts } from '@/lib/server/repo.mjs';
import { tomorrowJst } from '@/lib/server/pipeline.mjs';
import { DIRECTIVE_ACTIONS } from '@/lib/server/directives.mjs';
import { applyDirective } from '@/lib/server/directive-apply.mjs';
import { jstDate } from '@/lib/server/signups.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user?.name) return Response.json({ error: 'ログインが必要です。' }, { status: 401 });

  let body = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '内容を読めませんでした。' }, { status: 400 });
  }
  const { accountId, action } = body ?? {};
  const date = body?.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : tomorrowJst();
  if (!DIRECTIVE_ACTIONS[action]) return Response.json({ error: '指示の種類が不正です。' }, { status: 400 });
  if (date < jstDate()) return Response.json({ error: '過ぎた日付には指示できません。' }, { status: 400 });

  const accounts = filterAccountsForUser(await listAccounts(), user);
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return Response.json({ error: 'その名義は扱えません。' }, { status: 403 });

  try {
    const r = await applyDirective({ account, action, date, setBy: user.name, regenerate: true });
    return Response.json({ ok: true, date: r.date, action: r.action, rejected: r.rejected, count: r.count, note: r.note });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
