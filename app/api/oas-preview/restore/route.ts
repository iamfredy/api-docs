import { NextResponse } from 'next/server';
import { OAS_PREVIEW_MAX_BYTES, isPreviewSessionId } from '@/lib/oas-preview-render';
import { preparePreviewSession, previewSessionPayload } from '@/lib/oas-preview-prepare';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Re-create a session on this Node process. Used when the iframe lands on a
 * worker/instance that never saw the original POST (Catalyst / multi-process).
 */
export async function POST(request: Request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > OAS_PREVIEW_MAX_BYTES + 512) {
    return NextResponse.json(
      { error: `Payload too large. Maximum size is ${OAS_PREVIEW_MAX_BYTES} bytes.` },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  if (!isPlainObject(body) || typeof body.id !== 'string' || !isPreviewSessionId(body.id)) {
    return NextResponse.json({ error: 'Invalid preview session id.' }, { status: 400 });
  }

  const prepared = preparePreviewSession(body, { id: body.id });
  if (!prepared.ok) {
    return NextResponse.json(prepared.body, { status: prepared.status });
  }

  return NextResponse.json(previewSessionPayload(prepared.session), {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
