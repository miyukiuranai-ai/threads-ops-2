// 直接 GCS へ PUT するための署名付き URL。指紋で重複を避ける。
import { NextResponse } from 'next/server';
import { getSession } from '@/app/_lib/session';
import { signedUploadUrl, findMedia, mediaPath, kindOf } from '@/lib/server/storage.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const { fingerprint, contentType, bytes, accountId } = body;
  if (!fingerprint || !contentType) return NextResponse.json({ error: 'fingerprint と contentType が要ります' }, { status: 400 });
  if (!/^(image|video)\//.test(contentType)) return NextResponse.json({ error: '画像か動画だけ' }, { status: 400 });
  const existing = await findMedia(fingerprint);
  if (existing) return NextResponse.json({ ok: true, exists: true, path: existing.path, kind: existing.kind, contentType: existing.contentType, bytes: existing.bytes });
  const path = mediaPath({ accountId: accountId || 'shared', fingerprint, contentType });
  const url = await signedUploadUrl({ path, contentType });
  return NextResponse.json({ ok: true, exists: false, url, path, kind: kindOf(contentType), contentType, bytes });
}
