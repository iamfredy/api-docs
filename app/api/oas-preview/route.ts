import { NextResponse } from 'next/server';
import {
  OAS_PREVIEW_MAX_BYTES,
  OAS_PREVIEW_MAX_OPERATIONS,
  findRefProblems,
  getPreviewSession,
  putPreviewSession,
  type PreviewOperation,
} from '@/lib/oas-preview-render';
import { createOasDirLoader, mergeExternalRefs } from '@/lib/oas-merge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

/** Create a preview session and return the iframe URL. */
export async function POST(request: Request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > OAS_PREVIEW_MAX_BYTES) {
    return NextResponse.json(
      { error: `Payload too large. Maximum size is ${OAS_PREVIEW_MAX_BYTES} bytes.` },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  if (!isPlainObject(body)) {
    return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
  }

  const rawText = JSON.stringify(body.document ?? {});
  if (rawText.length > OAS_PREVIEW_MAX_BYTES) {
    return NextResponse.json(
      { error: `OAS document too large. Maximum size is ${OAS_PREVIEW_MAX_BYTES} bytes.` },
      { status: 413 },
    );
  }

  const docError = validateDocument(body.document);
  if (docError) {
    return NextResponse.json({ error: docError }, { status: 400 });
  }

  const operations = normalizeOperations(body.operations);
  if (typeof operations === 'string') {
    return NextResponse.json({ error: operations }, { status: 400 });
  }

  // Cross-file refs cannot resolve from an in-memory document, so inline them against the
  // portable specs in `oas/` before the renderer ever sees the document.
  const { document: portable, stats: mergeStats } = mergeExternalRefs(
    body.document as Record<string, unknown>,
    createOasDirLoader(),
  );

  if (mergeStats.missing.length > 0) {
    return NextResponse.json(
      {
        error:
          `This document references files that are not available: ${mergeStats.missing.join(', ')}. ` +
          'Upload a document whose shared definitions are already merged in, or add those files to the oas/ folder.',
        missingFiles: mergeStats.missing,
      },
      { status: 422 },
    );
  }

  if (mergeStats.unresolved.length > 0) {
    const shown = mergeStats.unresolved.slice(0, 5).join(', ');
    return NextResponse.json(
      {
        error:
          `${mergeStats.unresolved.length} reference(s) point at definitions that do not exist in the files available here: ${shown}. ` +
          'That usually means the companion file is a different version. Merge the shared definitions into your document and upload it again.',
        unresolvedRefs: mergeStats.unresolved.slice(0, 50),
      },
      { status: 422 },
    );
  }

  const refProblems = findRefProblems(portable);
  if (refProblems.dangling.length > 0) {
    return NextResponse.json(
      {
        error: `Document contains ${refProblems.dangling.length} reference(s) that do not resolve, starting with ${refProblems.dangling[0]}.`,
        danglingRefs: refProblems.dangling.slice(0, 50),
      },
      { status: 422 },
    );
  }

  // Ensure selected operations exist on the document
  const paths = portable.paths as Record<string, unknown>;
  for (const op of operations) {
    const pathItem = paths[op.path];
    if (!isPlainObject(pathItem) || !pathItem[op.method]) {
      return NextResponse.json(
        { error: `Operation not found in document: ${op.method.toUpperCase()} ${op.path}` },
        { status: 400 },
      );
    }
  }

  try {
    const session = putPreviewSession(portable, operations, mergeStats);
    return NextResponse.json({
      id: session.id,
      title: session.title,
      previewUrl: `/oas-preview-frame/${session.id}`,
      exportUrl: `/api/oas-preview/export?id=${encodeURIComponent(session.id)}`,
      portableUrl: `/api/oas-preview/portable?id=${encodeURIComponent(session.id)}`,
      merge: session.mergeStats,
      server: session.server,
      patterns: session.patternStats,
    });
  } catch (error) {
    console.error('oas-preview POST failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create preview session.' },
      { status: 500 },
    );
  }
}

/** Lightweight session probe. */
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
    operations: session.operations,
    previewUrl: `/oas-preview-frame/${session.id}`,
    exportUrl: `/api/oas-preview/export?id=${encodeURIComponent(session.id)}`,
    portableUrl: `/api/oas-preview/portable?id=${encodeURIComponent(session.id)}`,
    merge: session.mergeStats,
    server: session.server,
    patterns: session.patternStats,
  });
}
