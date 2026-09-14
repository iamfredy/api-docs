import type { PreviewOperation } from '@/lib/oas-preview-render';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function collectComponentRefs(node: unknown, used: Set<string>) {
  if (Array.isArray(node)) {
    for (const item of node) collectComponentRefs(item, used);
    return;
  }
  if (!isPlainObject(node)) return;
  const ref = node.$ref;
  if (typeof ref === 'string' && ref.startsWith('#/components/')) {
    used.add(ref);
  }
  for (const value of Object.values(node)) collectComponentRefs(value, used);
}

function componentFromRef(ref: string): { section: string; name: string } | null {
  const match = /^#\/components\/([^/]+)\/(.+)$/.exec(ref);
  if (!match) return null;
  return { section: decodeURIComponent(match[1]), name: decodeURIComponent(match[2]) };
}

/**
 * Keep only the selected operations and the component definitions they reference.
 * Needed so a cookie-sized payload can be sent to the preview frame on serverless.
 */
export function trimDocumentForPreview(
  document: Record<string, unknown>,
  operations: PreviewOperation[],
): Record<string, unknown> {
  const paths = isPlainObject(document.paths) ? document.paths : {};
  const trimmedPaths: Record<string, unknown> = {};

  for (const op of operations) {
    const pathItem = paths[op.path];
    if (!isPlainObject(pathItem)) continue;
    const current = isPlainObject(trimmedPaths[op.path])
      ? { ...trimmedPaths[op.path] }
      : {};
    if (pathItem.parameters) current.parameters = pathItem.parameters;
    if (pathItem.summary) current.summary = pathItem.summary;
    if (pathItem.description) current.description = pathItem.description;
    current[op.method] = pathItem[op.method];
    trimmedPaths[op.path] = current;
  }

  const used = new Set<string>();
  collectComponentRefs(trimmedPaths, used);

  const sourceComponents = isPlainObject(document.components) ? document.components : {};
  const trimmedComponents: Record<string, Record<string, unknown>> = {};
  const queue = [...used];

  while (queue.length > 0) {
    const ref = queue.pop()!;
    const parsed = componentFromRef(ref);
    if (!parsed) continue;
    const section = sourceComponents[parsed.section];
    if (!isPlainObject(section) || !(parsed.name in section)) continue;
    const bucket = (trimmedComponents[parsed.section] ??= {});
    if (parsed.name in bucket) continue;
    const definition = section[parsed.name];
    bucket[parsed.name] = definition;
    const nested = new Set<string>();
    collectComponentRefs(definition, nested);
    for (const next of nested) {
      if (!used.has(next)) {
        used.add(next);
        queue.push(next);
      }
    }
  }

  const trimmed: Record<string, unknown> = {
    paths: trimmedPaths,
  };
  if (document.openapi) trimmed.openapi = document.openapi;
  if (document.swagger) trimmed.swagger = document.swagger;
  if (document.info) trimmed.info = document.info;
  if (document.servers) trimmed.servers = document.servers;
  if (document.security) trimmed.security = document.security;
  if (Object.keys(trimmedComponents).length > 0) trimmed.components = trimmedComponents;
  return trimmed;
}
