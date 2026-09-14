'use server';

import { createElement } from 'react';
import { preparePreviewSession } from '@/lib/oas-preview-prepare';
import { createPreviewAPIPage, toOperationItems, type PreviewOperation } from '@/lib/oas-preview-render';

export async function renderStoredPreview(
  document: Record<string, unknown>,
  operations: PreviewOperation[],
) {
  const prepared = preparePreviewSession({ document, operations });
  if (!prepared.ok) {
    throw new Error(
      typeof prepared.body.error === 'string' ? prepared.body.error : 'Preview render failed.',
    );
  }

  const APIPage = createPreviewAPIPage(prepared.session.document);
  return createElement(APIPage, {
    document: 'preview',
    operations: toOperationItems(prepared.session.operations),
    showTitle: true,
    showDescription: true,
  });
}
