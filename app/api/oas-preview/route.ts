import { NextResponse } from 'next/server';
import { OAS_PREVIEW_MAX_BYTES, getPreviewSession } from '@/lib/oas-preview-render';
import { preparePreviewSession, previewSessionPayload } from '@/lib/oas-preview-prepare';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Create a preview session and return the iframe URL. */
export async function POST(request: Request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > OAS_PREVIEW_MAX_BYTES) {
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

  const prepared = preparePreviewSession(body);
  if (!prepared.ok) {
    return NextResponse.json(prepared.body, { status: prepared.status });
  }

  try {
    return NextResponse.json(previewSessionPayload(prepared.session), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    console.error('oas-preview POST failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create preview session.' },
      { status: 500 },
    );
  }
}

/** Lightweight session probe. */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Missing id query parameter.' }, { status: 400 });
  }
  const session = getPreviewSession(id);
  if (!session) {
    return NextResponse.json({ error: 'Preview session not found or expired.' }, { status: 404 });
  }
  return NextResponse.json(previewSessionPayload(session), {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
