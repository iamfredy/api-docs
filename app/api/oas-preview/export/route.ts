import { NextResponse } from 'next/server';
import { getPreviewSession } from '@/lib/oas-preview-render';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Metadata for portable HTML download.
 * The browser builds the offline file by fetching the preview frame and inlining CSS
 * (Next.js App Router disallows react-dom/server inside route handlers).
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Missing id query parameter.' }, { status: 400 });
  }

  const session = getPreviewSession(id);
  if (!session) {
    return NextResponse.json({ error: 'Preview session not found or expired.' }, { status: 404 });
  }

  return NextResponse.json({
    id: session.id,
    title: session.title,
    previewUrl: `/oas-preview-frame/${session.id}`,
    operations: session.operations,
  });
}
