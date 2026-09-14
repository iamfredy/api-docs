import fs from 'fs';
import path from 'path';

/**
 * Inlines cross-file `$ref`s into a single document, the way the product's
 * `MergeAndGenerateDocs` Java utility turns `support/*.json` + `common/Common.json` into a
 * portable spec. Imported fragments land in the document's own `components` section and the
 * references are rewritten to `#/components/...`, so the result needs no companion files.
 */

export type MergeStats = {
  /** Number of `$ref` values rewritten from a file reference to an internal pointer. */
  rewritten: number;
  /** Referenced file names that were found and merged, with a count of refs into each. */
  sources: { file: string; refs: number }[];
  /** Referenced file names that could not be found anywhere on the search path. */
  missing: string[];
  /** Refs whose file was found but whose pointer does not exist in it. */
  unresolved: string[];
};

export type MergeResult = {
  document: Record<string, unknown>;
  stats: MergeStats;
};

/**
 * Returns every candidate document for a referenced file name, in priority order. More than one
 * is allowed because the same base name can exist in several folders (for example the portable
 * `oas/Common.json` and the product's `resources/oas/common/Common.json`), and only one of them
 * may actually contain the pointer being referenced.
 */
export type FileLoader = (fileName: string) => Record<string, unknown>[];

const COMPONENT_SECTIONS = new Set([
  'schemas',
  'responses',
  'parameters',
  'examples',
  'requestBodies',
  'headers',
  'securitySchemes',
  'links',
  'callbacks',
  'pathItems',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function decodeSegment(segment: string): string {
  return decodeURIComponent(segment).replace(/~1/g, '/').replace(/~0/g, '~');
}

function resolvePointer(document: unknown, pointer: string): unknown {
  if (pointer === '' || pointer === '/') return document;
  let current: unknown = document;
  for (const rawSegment of pointer.replace(/^\//, '').split('/')) {
    const segment = decodeSegment(rawSegment);
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
      continue;
    }
    if (!isRecord(current)) return undefined;
    if (!(segment in current)) return undefined;
    current = current[segment];
  }
  return current;
}

function fileStem(fileName: string): string {
  return path.basename(fileName).replace(/\.json$/i, '');
}

/** `/components/schemas/foo` -> section `schemas`, name `foo`. */
function placementFor(pointer: string, sourceFile: string): { section: string; name: string } {
  const segments = pointer
    .replace(/^\//, '')
    .split('/')
    .map(decodeSegment)
    .filter(Boolean);

  if (segments[0] === 'components' && segments.length >= 3 && COMPONENT_SECTIONS.has(segments[1])) {
    return { section: segments[1], name: segments.slice(2).join('_') };
  }

  const tail = segments[segments.length - 1] ?? 'imported';
  return { section: 'schemas', name: `${fileStem(sourceFile)}_${tail}` };
}

export function mergeExternalRefs(
  document: Record<string, unknown>,
  loadFile: FileLoader,
): MergeResult {
  const merged = structuredClone(document) as Record<string, unknown>;
  const components: Record<string, unknown> = isRecord(merged.components)
    ? (merged.components as Record<string, unknown>)
    : {};
  merged.components = components;

  const loaded = new Map<string, Record<string, unknown>[]>();
  const refCounts = new Map<string, number>();
  const missing = new Set<string>();
  const unresolved = new Set<string>();
  // `<file>#<pointer>` -> internal pointer it was imported to, so cycles terminate and
  // repeated references share one copy.
  const imported = new Map<string, string>();
  let rewritten = 0;

  const load = (fileName: string): Record<string, unknown>[] => {
    const key = path.basename(fileName);
    if (!loaded.has(key)) loaded.set(key, loadFile(key));
    return loaded.get(key) ?? [];
  };

  const sectionOf = (section: string): Record<string, unknown> => {
    if (!isRecord(components[section])) components[section] = {};
    return components[section] as Record<string, unknown>;
  };

  /**
   * Imports `<sourceFile>#<pointer>` into the target components and returns the internal
   * pointer, or null when the source file or pointer is unavailable.
   */
  const importFragment = (sourceFile: string, pointer: string): string | null => {
    const cacheKey = `${path.basename(sourceFile)}#${pointer}`;
    const already = imported.get(cacheKey);
    if (already) return already;

    const candidates = load(sourceFile);
    if (candidates.length === 0) {
      // A file that references itself by name is really pointing at the document being built.
      if (resolvePointer(merged, pointer) !== undefined) return `#${pointer}`;
      missing.add(sourceFile);
      return null;
    }

    let fragment: unknown;
    for (const candidate of candidates) {
      fragment = resolvePointer(candidate, pointer);
      if (fragment !== undefined) break;
    }
    if (fragment === undefined) {
      // Same self-reference case, but the base name also exists on the search path.
      if (resolvePointer(merged, pointer) !== undefined) return `#${pointer}`;
      unresolved.add(`${path.basename(sourceFile)}#${pointer}`);
      return null;
    }

    const { section, name } = placementFor(pointer, sourceFile);
    const bucket = sectionOf(section);

    // A name the document already uses keeps its own definition; the imported fragment is
    // qualified with its source file instead, so both survive and every reference still
    // points at the definition it actually meant.
    let targetName = name;
    if (Object.prototype.hasOwnProperty.call(bucket, targetName)) {
      const qualified = `${name}_${fileStem(sourceFile)}`;
      targetName = qualified;
      let counter = 2;
      while (Object.prototype.hasOwnProperty.call(bucket, targetName)) {
        targetName = `${qualified}_${counter}`;
        counter += 1;
      }
    }

    const internalPointer = `#/components/${section}/${targetName}`;
    // Record before walking so a fragment that references itself resolves to this slot.
    imported.set(cacheKey, internalPointer);

    const copy = structuredClone(fragment);
    bucket[targetName] = copy;
    // References inside an imported fragment are relative to the file it came from, including
    // plain `#/...` pointers, which address that file rather than the document being built.
    rewriteRefs(copy, sourceFile);

    return internalPointer;
  };

  /**
   * Rewrites `$ref`s under `node`. `contextFile` is null for the document being built (its own
   * `#/...` refs already resolve locally) and a file name for imported fragments.
   */
  function rewriteRefs(node: unknown, contextFile: string | null) {
    if (Array.isArray(node)) {
      for (const item of node) rewriteRefs(item, contextFile);
      return;
    }
    if (!isRecord(node)) return;

    const ref = node.$ref;
    if (typeof ref === 'string') {
      const isInternal = ref.startsWith('#');
      if (!isInternal || contextFile) {
        const [rawFile, rawPointer = ''] = ref.split('#');
        const sourceFile = rawFile || contextFile;
        if (sourceFile) {
          refCounts.set(
            path.basename(sourceFile),
            (refCounts.get(path.basename(sourceFile)) ?? 0) + 1,
          );
          const internal = importFragment(sourceFile, rawPointer);
          if (internal) {
            node.$ref = internal;
            rewritten += 1;
          }
        }
      }
    }

    for (const value of Object.values(node)) rewriteRefs(value, contextFile);
  }

  rewriteRefs(merged, null);

  if (Object.keys(components).length === 0) delete merged.components;

  return {
    document: merged,
    stats: {
      rewritten,
      sources: [...refCounts.entries()]
        .filter(([file]) => !missing.has(file))
        .map(([file, refs]) => ({ file, refs }))
        .sort((a, b) => b.refs - a.refs),
      missing: [...missing].map((file) => path.basename(file)),
      unresolved: [...unresolved],
    },
  };
}

/** Folders searched for referenced files, in priority order. */
export const OAS_SEARCH_DIRS = ['oas', 'resources/oas/common', 'resources/oas/support'];

/**
 * Loads referenced files from this repository's OAS folders. Only the base name is used, so
 * `./Common.json` and `../common/Common.json` both find the same candidates and a reference can
 * never escape the search path. Both the portable `oas/` copies and the product's split
 * `resources/` copies are offered, because a pointer may only exist in one of them.
 */
export function createOasDirLoader(dirs: string[] = OAS_SEARCH_DIRS): FileLoader {
  const roots = dirs.map((dir) => path.resolve(process.cwd(), dir));
  const cache = new Map<string, Record<string, unknown>[]>();

  return (fileName) => {
    const base = path.basename(fileName);
    const cached = cache.get(base);
    if (cached) return cached;

    const found: Record<string, unknown>[] = [];
    if (/\.json$/i.test(base)) {
      for (const root of roots) {
        try {
          const contents = JSON.parse(fs.readFileSync(path.join(root, base), 'utf8'));
          if (isRecord(contents)) found.push(contents);
        } catch {
          // Not in this folder; try the next one.
        }
      }
    }

    cache.set(base, found);
    return found;
  };
}
