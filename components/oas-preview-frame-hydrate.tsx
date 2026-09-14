'use client';

import { useEffect, useState } from 'react';
import {
  oasPreviewHydratedKey,
  oasPreviewStorageKey,
  type StoredPreview,
} from '@/lib/oas-preview-storage';

export function OasPreviewFrameHydrate({ id }: { id: string }) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (sessionStorage.getItem(oasPreviewHydratedKey(id))) {
      setError(
        'This preview is not available on the server anymore. Go back to the generator and click Preview again.',
      );
      return;
    }

    const raw = sessionStorage.getItem(oasPreviewStorageKey(id));
    if (!raw) {
      setError(
        'This preview session was not found. Go back to the generator and click Preview again.',
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
    fetch('/api/oas-preview/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        document: stored.document,
        operations: stored.operations,
      }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof data.error === 'string' ? data.error : `Restore failed (${response.status})`,
          );
        }
        sessionStorage.setItem(oasPreviewHydratedKey(id), '1');
        if (!cancelled) window.location.reload();
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not restore this preview.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="m-4 rounded-lg border border-fd-border bg-fd-secondary p-4 text-sm text-fd-muted-foreground">
      {error ? (
        <p role="alert" className="text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : (
        <p>Restoring this preview on the server…</p>
      )}
    </div>
  );
}
