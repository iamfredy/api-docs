import { connection } from 'next/server';
import { OasPreviewFrameHydrate } from '@/components/oas-preview-frame-hydrate';
import {
  createPreviewAPIPage,
  getPreviewSession,
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
  // Production used to prerender this route, call notFound() with an empty store,
  // and then serve that static 404 for every preview id.
  await connection();
  const { id } = await params;
  const session = getPreviewSession(id);
  if (!session) {
    return <OasPreviewFrameHydrate id={id} />;
  }

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
