import { NextResponse } from 'next/server';
import { getPreviewSession } from '@/lib/oas-preview-render';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fileNameFor(title: string): string {
  const base = title.replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '') || 'api';
  return `${base}-portable.json`;
}

/** Downloads the previewed document as a self-contained (portable) OpenAPI file. */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Missing id query parameter.' }, { status: 400 });
  }

  const session = getPreviewSession(id);
  if (!session) {
    return NextResponse.json({ error: 'Preview session not found or expired.' }, { status: 404 });
  }

  return new NextResponse(JSON.stringify(session.document, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileNameFor(session.title)}"`,
      'Cache-Control': 'no-store',
    },
  });
}
