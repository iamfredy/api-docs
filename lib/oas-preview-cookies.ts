import { cookies } from 'next/headers';
import { gzipSync, gunzipSync } from 'node:zlib';
import {
  PREVIEW_COOKIE_CHUNK_SIZE,
  PREVIEW_COOKIE_MAX_CHUNKS,
  PREVIEW_COOKIE_PATH,
  PREVIEW_COOKIE_PREFIX,
} from '@/lib/oas-preview-cookies-shared';
import { trimDocumentForPreview } from '@/lib/oas-preview-trim';
import type { PreviewOperation, PreviewSession } from '@/lib/oas-preview-render';

export type CookiePreviewPayload = {
  id: string;
  document: Record<string, unknown>;
  operations: PreviewOperation[];
};

function fromBase64Url(value: string): Buffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, 'base64');
}

export function encodePreviewCookies(session: PreviewSession): { name: string; value: string }[] {
  const trimmed = trimDocumentForPreview(session.document, session.operations);
  const payload = JSON.stringify({
    id: session.id,
    document: trimmed,
    operations: session.operations,
  });
  const encoded = gzipSync(payload).toString('base64url');
  const chunks: string[] = [];
  for (let index = 0; index < encoded.length; index += PREVIEW_COOKIE_CHUNK_SIZE) {
    chunks.push(encoded.slice(index, index + PREVIEW_COOKIE_CHUNK_SIZE));
  }
  if (chunks.length > PREVIEW_COOKIE_MAX_CHUNKS) {
    return [];
  }
  return [
    { name: `${PREVIEW_COOKIE_PREFIX}id`, value: session.id },
    { name: `${PREVIEW_COOKIE_PREFIX}n`, value: String(chunks.length) },
    ...chunks.map((value, index) => ({ name: `${PREVIEW_COOKIE_PREFIX}${index}`, value })),
  ];
}

export async function readPreviewFromCookies(id: string): Promise<CookiePreviewPayload | null> {
  const jar = await cookies();
  if (jar.get(`${PREVIEW_COOKIE_PREFIX}id`)?.value !== id) return null;
  const count = Number(jar.get(`${PREVIEW_COOKIE_PREFIX}n`)?.value ?? 0);
  if (!Number.isInteger(count) || count < 1 || count > PREVIEW_COOKIE_MAX_CHUNKS) {
    return null;
  }

  let encoded = '';
  for (let index = 0; index < count; index += 1) {
    const part = jar.get(`${PREVIEW_COOKIE_PREFIX}${index}`)?.value;
    if (!part) return null;
    encoded += part;
  }

  try {
    const json = gunzipSync(fromBase64Url(encoded)).toString('utf8');
    const parsed = JSON.parse(json) as CookiePreviewPayload;
    if (parsed.id !== id || !parsed.document || !Array.isArray(parsed.operations)) return null;
    return parsed;
  } catch {
    return null;
  }
}
