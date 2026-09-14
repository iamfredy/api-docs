import { createOpenAPI } from 'fumadocs-openapi/server';
import path from 'path';
import fs from 'fs';
import { createOasDirLoader, mergeExternalRefs } from '@/lib/oas-merge';
import { normalizePatterns, normalizeServers } from '@/lib/oas-normalize';

// Suppress noisy openapi-sampler warnings about allOf type conflicts.
// These are harmless — openapi-sampler resolves them by using the last type.
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes("schemas with different types can't be merged")) {
    return;
  }
  originalWarn.apply(console, args);
};

const oasDir = path.resolve(process.cwd(), 'oas');

const oasFiles = fs
  .readdirSync(oasDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => path.join('oas', f));

/**
 * The specs are handed over as objects rather than paths so they can be normalised on the way in.
 * They come from the product's Java-side tooling, which leaves behind two things a browser cannot
 * render: no absolute `servers` entry, which makes the request samples differ between the server
 * and client render, and Java-only regex syntax, which throws while building the request body form.
 * Passing objects means `$ref`s to sibling files no longer resolve on their own, so they are
 * inlined first. fumadocs-openapi processes every listed document on first access anyway, so this
 * adds no work beyond the merge.
 */
const loadOasFiles = () => {
  const loader = createOasDirLoader();

  return Object.fromEntries(
    oasFiles.map((file) => {
      const raw = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), 'utf8'));
      const { document } = mergeExternalRefs(raw as Record<string, unknown>, loader);
      normalizeServers(document);
      normalizePatterns(document);
      return [file, document];
    }),
  );
};

export const openapi = createOpenAPI({
  input: loadOasFiles,
});
