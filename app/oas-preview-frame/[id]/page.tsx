import { notFound } from 'next/navigation';
import {
  createPreviewAPIPage,
  getPreviewSession,
  toOperationItems,
} from '@/lib/oas-preview-render';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function OasPreviewFramePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = getPreviewSession(id);
  if (!session) notFound();

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
