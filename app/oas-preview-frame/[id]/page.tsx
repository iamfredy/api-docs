import { connection } from 'next/server';
import { OasPreviewFrameClient } from '@/components/oas-preview-frame-client';
import { readPreviewFromCookies } from '@/lib/oas-preview-cookies';
import {
  createPreviewAPIPage,
  getPreviewSession,
  putPreviewSession,
  toOperationItems,
} from '@/lib/oas-preview-render';

export const dynamic = 'force-dynamic';
export const dynamicParams = true;
export const revalidate = 0;
export const runtime = 'nodejs';

export default async function OasPreviewFramePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const { id } = await params;
  let session = getPreviewSession(id);
  if (!session) {
    const fromCookie = await readPreviewFromCookies(id);
    if (fromCookie) {
      session = putPreviewSession(fromCookie.document, fromCookie.operations, {
        rewritten: 0,
        sources: [],
        missing: [],
        unresolved: [],
      }, id);
    }
  }
  if (session) {
    const APIPage = createPreviewAPIPage(session.document);
    return (
      <APIPage
        document="preview"
        operations={toOperationItems(session.operations)}
        showTitle
        showDescription
      />
    );
  }

  // Catalyst/OpenNext and other serverless hosts do not share memory between
  // the Preview POST and this GET. The client re-sends the document in a
  // Server Action so rendering happens in the same request as the payload.
  return <OasPreviewFrameClient id={id} />;
}
