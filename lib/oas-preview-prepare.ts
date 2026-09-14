import {
  OAS_PREVIEW_MAX_BYTES,
  OAS_PREVIEW_MAX_OPERATIONS,
  findRefProblems,
  isPreviewSessionId,
  putPreviewSession,
  type PreviewOperation,
  type PreviewSession,
} from '@/lib/oas-preview-render';
import { createOasDirLoader, mergeExternalRefs } from '@/lib/oas-merge';

const HTTP_METHODS = new Set([
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validateDocument(document: unknown): string | null {
  if (!isPlainObject(document)) return 'Document must be a JSON object.';
  if (!document.openapi && !document.swagger) {
    return 'Document must include an "openapi" or "swagger" version field.';
  }
  if (!isPlainObject(document.paths)) {
    return 'Document must include a "paths" object.';
  }
  return null;
}

function normalizeOperations(raw: unknown): PreviewOperation[] | string {
  if (!Array.isArray(raw) || raw.length === 0) {
    return 'Select at least one operation to preview.';
  }
  if (raw.length > OAS_PREVIEW_MAX_OPERATIONS) {
    return `Select at most ${OAS_PREVIEW_MAX_OPERATIONS} operations for a live preview.`;
  }
  const ops: PreviewOperation[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) return 'Each operation must be an object with path and method.';
    const path = item.path;
    const method = String(item.method ?? '').toLowerCase();
    if (typeof path !== 'string' || !path.startsWith('/')) {
      return 'Each operation path must be a string starting with "/".';
    }
    if (!HTTP_METHODS.has(method)) {
      return `Unsupported HTTP method: ${item.method}`;
    }
    ops.push({ path, method });
  }
  return ops;
}

export type PreparePreviewFailure = {
  ok: false;
  status: number;
  body: Record<string, unknown>;
};

export type PreparePreviewSuccess = {
  ok: true;
  session: PreviewSession;
};

export function previewSessionPayload(session: PreviewSession) {
  return {
    id: session.id,
    title: session.title,
    previewUrl: `/oas-preview-frame/${session.id}`,
    exportUrl: `/api/oas-preview/export?id=${encodeURIComponent(session.id)}`,
    portableUrl: `/api/oas-preview/portable?id=${encodeURIComponent(session.id)}`,
    operations: session.operations,
    document: session.document,
    merge: session.mergeStats,
    server: session.server,
    patterns: session.patternStats,
  };
}

/**
 * Validate, merge companion files, and store a preview session.
 * Shared by POST /api/oas-preview and POST /api/oas-preview/restore.
 */
export function preparePreviewSession(
  body: unknown,
  options?: { id?: string },
): PreparePreviewSuccess | PreparePreviewFailure {
  if (!isPlainObject(body)) {
    return { ok: false, status: 400, body: { error: 'Request body must be a JSON object.' } };
  }

  if (options?.id && !isPreviewSessionId(options.id)) {
    return { ok: false, status: 400, body: { error: 'Invalid preview session id.' } };
  }

  const rawText = JSON.stringify(body.document ?? {});
  if (rawText.length > OAS_PREVIEW_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      body: { error: `OAS document too large. Maximum size is ${OAS_PREVIEW_MAX_BYTES} bytes.` },
    };
  }

  const docError = validateDocument(body.document);
  if (docError) {
    return { ok: false, status: 400, body: { error: docError } };
  }

  const operations = normalizeOperations(body.operations);
  if (typeof operations === 'string') {
    return { ok: false, status: 400, body: { error: operations } };
  }

  const { document: portable, stats: mergeStats } = mergeExternalRefs(
    body.document as Record<string, unknown>,
    createOasDirLoader(),
  );

  if (mergeStats.missing.length > 0) {
    return {
      ok: false,
      status: 422,
      body: {
        error:
          `This document references files that are not available: ${mergeStats.missing.join(', ')}. ` +
          'Upload a document whose shared definitions are already merged in, or add those files to the oas/ folder.',
        missingFiles: mergeStats.missing,
      },
    };
  }

  if (mergeStats.unresolved.length > 0) {
    const shown = mergeStats.unresolved.slice(0, 5).join(', ');
    return {
      ok: false,
      status: 422,
      body: {
        error:
          `${mergeStats.unresolved.length} reference(s) point at definitions that do not exist in the files available here: ${shown}. ` +
          'That usually means the companion file is a different version. Merge the shared definitions into your document and upload it again.',
        unresolvedRefs: mergeStats.unresolved.slice(0, 50),
      },
    };
  }

  const refProblems = findRefProblems(portable);
  if (refProblems.dangling.length > 0) {
    return {
      ok: false,
      status: 422,
      body: {
        error: `Document contains ${refProblems.dangling.length} reference(s) that do not resolve, starting with ${refProblems.dangling[0]}.`,
        danglingRefs: refProblems.dangling.slice(0, 50),
      },
    };
  }

  const paths = portable.paths as Record<string, unknown>;
  for (const op of operations) {
    const pathItem = paths[op.path];
    if (!isPlainObject(pathItem) || !pathItem[op.method]) {
      return {
        ok: false,
        status: 400,
        body: { error: `Operation not found in document: ${op.method.toUpperCase()} ${op.path}` },
      };
    }
  }

  const session = putPreviewSession(portable, operations, mergeStats, options?.id);
  return { ok: true, session };
}
