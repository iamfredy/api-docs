import { createOpenAPI } from 'fumadocs-openapi/server';
import fs from 'fs';
import path from 'path';
import { createOasDirLoader, mergeExternalRefs } from '@/lib/oas-merge';
import { normalizePatterns, normalizeServers } from '@/lib/oas-normalize';

// Suppress noisy openapi-sampler warnings about allOf type conflicts.
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes("schemas with different types can't be merged")) {
    return;
  }
  originalWarn.apply(console, args);
};

const loader = createOasDirLoader();
const schemaCache = new Map<string, Promise<unknown>>();

function readNormalizedDocument(file: string): Record<string, unknown> {
  const absolute = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
  const raw = JSON.parse(fs.readFileSync(absolute, 'utf8')) as Record<string, unknown>;
  const { document } = mergeExternalRefs(raw, loader);
  normalizeServers(document);
  normalizePatterns(document);
  return document;
}

/**
 * Do not preload every spec. fumadocs-openapi's default `input()` path runs
 * `getSchemas()` on first render and processes the entire `oas/` folder.
 * On Catalyst/OpenNext that exceeds the origin timeout and the edge returns 503
 * even for `/docs`. Load and normalise only the file the page asked for.
 */
const server = createOpenAPI({ input: [] });
const getSchema = server.getSchema.bind(server);

server.getSchema = async (document: string) => {
  let pending = schemaCache.get(document);
  if (!pending) {
    pending = getSchema(readNormalizedDocument(document) as unknown as string);
    schemaCache.set(document, pending);
  }
  return pending as ReturnType<typeof getSchema>;
};

export const openapi = server;
