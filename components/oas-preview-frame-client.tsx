'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { renderStoredPreview } from '@/lib/oas-preview-actions';
import { oasPreviewStorageKey, type StoredPreview } from '@/lib/oas-preview-storage';

export function OasPreviewFrameClient({ id }: { id: string }) {
  const [view, setView] = useState<ReactNode>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem(oasPreviewStorageKey(id));
    if (!raw) {
      setError(
        'This preview is only available in the tab that generated it. Go back and click Preview again.',
      );
      return;
    }

    let stored: StoredPreview;
    try {
      stored = JSON.parse(raw) as StoredPreview;
    } catch {
      setError('Stored preview data is invalid. Click Preview again on the generator page.');
      return;
    }

    let cancelled = false;
    renderStoredPreview(stored.document, stored.operations)
      .then((node) => {
        if (!cancelled) {
          setView(node);
          window.parent.postMessage({ type: 'oas-preview-ready' }, window.location.origin);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not render this preview.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) {
    return (
      <p role="alert" className="m-4 text-sm text-red-700 dark:text-red-300">
        {error}
      </p>
    );
  }

  if (!view) {
    return <p className="m-4 text-sm text-fd-muted-foreground">Rendering preview…</p>;
  }

  return view;
}
