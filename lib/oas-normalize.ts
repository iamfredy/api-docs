/**
 * Normalisations that make a spec safe for fumadocs-openapi to render in a browser. Both are
 * about JavaScript semantics rather than OpenAPI correctness, so they apply to any document the
 * site renders, whether it ships in `oas/` or was pasted into the preview tool.
 */

/** Matches the default the product's merge tool applies when a spec declares no server. */
export const DEFAULT_SERVER_URL = 'https://desk.zoho.com';

/**
 * fumadocs-openapi builds request samples with
 * `withBase(url, typeof window !== 'undefined' ? location.origin : 'https://loading')`, so a
 * document whose first server is missing or relative renders `https://loading/...` on the server
 * and `http://localhost:3000/...` in the browser — a guaranteed hydration mismatch. Supplying an
 * absolute server up front (the same normalisation MergeAndGenerateDocs performs) makes both
 * renders identical.
 */
export function normalizeServers(
  document: Record<string, unknown>,
  fallback = DEFAULT_SERVER_URL,
): { url: string; assumed: boolean } {
  const servers = Array.isArray(document.servers) ? [...document.servers] : [];
  const index = servers.findIndex(
    (entry) =>
      !!entry &&
      typeof entry === 'object' &&
      typeof (entry as Record<string, unknown>).url === 'string' &&
      ((entry as Record<string, unknown>).url as string).trim().length > 0,
  );

  if (index === -1) {
    document.servers = [{ url: fallback }, ...servers];
    return { url: fallback, assumed: true };
  }

  const entry = { ...(servers[index] as Record<string, unknown>) };
  const url = (entry.url as string).trim();
  const absolute = /^https?:\/\//i.test(url)
    ? url
    : `${fallback.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;

  entry.url = absolute;
  servers[index] = entry;
  document.servers = servers;
  return { url: absolute, assumed: absolute !== url };
}

/** Characters a `\x` escape may still use in unicode mode. */
const SYNTAX_CHARACTERS = new Set('^$\\.*+?()[]{}|/'.split(''));

const compiles = (pattern: string) => {
  try {
    new RegExp(pattern, 'u');
    return true;
  } catch {
    return false;
  }
};

const stripRedundantEscapes = (pattern: string, includeDash: boolean) =>
  pattern.replace(/\\([^\w\s]|_)/g, (match, char: string) => {
    if (SYNTAX_CHARACTERS.has(char)) return match;
    if (char === '-' && !includeDash) return match;
    return char;
  });

/**
 * Rewrites a Java-flavoured pattern into one JavaScript accepts, or returns null when it cannot.
 * The specs are authored against Java's regex engine, which allows escapes unicode-mode JavaScript
 * rejects (`\,`, `\:`, `\!`) and block properties it has no equivalent for (`\p{InBasicLatin}`).
 */
export function toJsPattern(pattern: string): string | null {
  const withoutJavaBlocks = pattern.replace(/\\[pP]\{[^}]*\}/g, '');
  const candidates = [
    pattern,
    withoutJavaBlocks,
    // A `\-` inside a character class is legal, so only unescape dashes as a last resort.
    stripRedundantEscapes(withoutJavaBlocks, false),
    stripRedundantEscapes(withoutJavaBlocks, true),
  ];

  for (const candidate of candidates) {
    if (candidate && compiles(candidate)) return candidate;
  }
  return null;
}

export type PatternStats = { repaired: number; dropped: number; total: number };

/**
 * fumadocs-openapi compiles every `pattern` it renders with the `u` flag, and one bad pattern
 * throws during render and takes the whole page down, so unusable ones are dropped outright.
 */
export function normalizePatterns(document: unknown): PatternStats {
  const stats: PatternStats = { repaired: 0, dropped: 0, total: 0 };

  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;

    const record = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (key === 'pattern' && typeof value === 'string') {
        stats.total += 1;
        if (compiles(value)) continue;

        const replacement = toJsPattern(value);
        if (replacement === null) {
          delete record.pattern;
          stats.dropped += 1;
        } else {
          record.pattern = replacement;
          stats.repaired += 1;
        }
        continue;
      }

      // `patternProperties` carries its regex in the key, and fumadocs-openapi compiles those keys
      // when it builds the request body form, so they need the same treatment.
      if (key === 'patternProperties' && value && typeof value === 'object' && !Array.isArray(value)) {
        const rewritten: Record<string, unknown> = {};
        for (const [rawKey, schema] of Object.entries(value as Record<string, unknown>)) {
          visit(schema);
          stats.total += 1;
          if (compiles(rawKey)) {
            rewritten[rawKey] = schema;
            continue;
          }
          const replacement = toJsPattern(rawKey);
          if (replacement === null) {
            stats.dropped += 1;
            continue;
          }
          rewritten[replacement] = schema;
          stats.repaired += 1;
        }
        record.patternProperties = rewritten;
        continue;
      }

      visit(value);
    }
  };

  visit(document);
  return stats;
}
