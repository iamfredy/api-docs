import { createOpenAPI } from 'fumadocs-openapi/server';
import { createAPIPage } from 'fumadocs-openapi/ui';
import { cloneAndAddSchemaTypes } from '@/lib/add-schema-types';
import type { MergeStats } from '@/lib/oas-merge';
import { normalizePatterns, normalizeServers, type PatternStats } from '@/lib/oas-normalize';
import previewClient from '@/components/oas-preview-api-page.client';

export const OAS_PREVIEW_MAX_BYTES = 3 * 1024 * 1024; // 3 MB
export const OAS_PREVIEW_MAX_OPERATIONS = 5;
export const OAS_PREVIEW_TTL_MS = 30 * 60 * 1000; // 30 minutes

export type PreviewOperation = {
  path: string;
  method: string;
};

export type PreviewSession = {
  id: string;
  /** Portable document: cross-file refs inlined, missing schema types filled in. */
  document: Record<string, unknown>;
  operations: PreviewOperation[];
  title: string;
  createdAt: number;
  mergeStats: MergeStats;
  /** Base URL used in request samples, and whether it had to be supplied. */
  server: { url: string; assumed: boolean };
  patternStats: PatternStats;
};

export type OperationItem = {
  path: string;
  method:
    | 'get'
    | 'post'
    | 'patch'
    | 'put'
    | 'delete'
    | 'head'
    | 'options'
    | 'trace';
};

const globalStore = globalThis as typeof globalThis & {
  __oasPreviewStore?: Map<string, PreviewSession>;
};

function store(): Map<string, PreviewSession> {
  if (!globalStore.__oasPreviewStore) {
    globalStore.__oasPreviewStore = new Map();
  }
  return globalStore.__oasPreviewStore;
}

function pruneExpired(now = Date.now()) {
  const s = store();
  for (const [id, session] of s) {
    if (now - session.createdAt > OAS_PREVIEW_TTL_MS) s.delete(id);
  }
}

export function putPreviewSession(
  document: Record<string, unknown>,
  operations: PreviewOperation[],
  mergeStats: MergeStats,
): PreviewSession {
  pruneExpired();
  const { document: normalized } = cloneAndAddSchemaTypes(document);
  const server = normalizeServers(normalized as Record<string, unknown>);
  const patternStats = normalizePatterns(normalized);
  const id = crypto.randomUUID();
  const info = normalized.info as { title?: string } | undefined;
  const session: PreviewSession = {
    id,
    document: normalized as Record<string, unknown>,
    operations,
    title: info?.title || 'API Documentation',
    createdAt: Date.now(),
    mergeStats,
    server,
    patternStats,
  };
  store().set(id, session);
  return session;
}

export function getPreviewSession(id: string): PreviewSession | undefined {
  pruneExpired();
  return store().get(id);
}

/** In-app iframe: full fidelity, including playground UI. */
export function createPreviewAPIPage(document: Record<string, unknown>) {
  const openapi = createOpenAPI({
    input: () => ({ preview: document }),
  });

  return createAPIPage(openapi, {
    client: previewClient,
    generateTypeScriptSchema: () => undefined,
  });
}

function resolvePointer(document: unknown, pointer: string): boolean {
  if (pointer === '' || pointer === '/') return true;
  let current: unknown = document;
  for (const rawSegment of pointer.replace(/^\//, '').split('/')) {
    const segment = decodeURIComponent(rawSegment).replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return false;
      current = current[index];
      continue;
    }
    if (!current || typeof current !== 'object') return false;
    if (!(segment in (current as Record<string, unknown>))) return false;
    current = (current as Record<string, unknown>)[segment];
  }
  return true;
}

export type RefProblems = {
  /** `$ref`s pointing at another file, e.g. `./Common.json#/components/responses/...`. */
  external: string[];
  /** In-document `$ref`s whose JSON pointer does not exist. */
  dangling: string[];
};

/**
 * A pasted document is resolved in memory, so it has no base directory: any `$ref` into a
 * sibling file is unresolvable no matter what the renderer does. Detecting that here lets the
 * UI explain the problem instead of letting fumadocs-openapi throw mid-render.
 */
export function findRefProblems(document: Record<string, unknown>): RefProblems {
  const external = new Set<string>();
  const dangling = new Set<string>();

  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const ref = record.$ref;
    if (typeof ref === 'string') {
      if (ref.startsWith('#')) {
        if (!resolvePointer(document, ref.slice(1))) dangling.add(ref);
      } else {
        external.add(ref);
      }
    }
    for (const value of Object.values(record)) visit(value);
  };

  visit(document);
  return { external: [...external], dangling: [...dangling] };
}

export function toOperationItems(operations: PreviewOperation[]): OperationItem[] {
  return operations.map((op) => ({
    path: op.path,
    method: op.method.toLowerCase() as OperationItem['method'],
  }));
}
