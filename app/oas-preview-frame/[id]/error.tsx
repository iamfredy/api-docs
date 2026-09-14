'use client';

export default function OasPreviewFrameError({ error }: { error: Error & { digest?: string } }) {
  return (
    <div className="m-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
      <p className="font-semibold">This document could not be rendered.</p>
      <p className="mt-2">
        The OpenAPI renderer failed on this document. The most common cause is a{' '}
        <code>$ref</code> that points outside the file, so nothing can resolve it.
      </p>
      {error.message ? (
        <pre className="mt-3 overflow-auto rounded bg-red-100 p-2 text-xs dark:bg-red-900/40">
          {error.message}
        </pre>
      ) : null}
      {error.digest ? <p className="mt-2 text-xs opacity-70">Digest: {error.digest}</p> : null}
    </div>
  );
}
