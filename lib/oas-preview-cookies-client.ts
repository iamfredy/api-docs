import {
  PREVIEW_COOKIE_CHUNK_SIZE,
  PREVIEW_COOKIE_MAX_CHUNKS,
  PREVIEW_COOKIE_PATH,
  PREVIEW_COOKIE_PREFIX,
} from '@/lib/oas-preview-cookies-shared';
import { trimDocumentForPreview } from '@/lib/oas-preview-trim';
import type { PreviewOperation } from '@/lib/oas-preview-render';

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function writeCookie(name: string, value: string, maxAge: number) {
  document.cookie = `${name}=${value}; path=${PREVIEW_COOKIE_PATH}; max-age=${maxAge}; SameSite=Lax`;
}

function clearPreviewCookies() {
  writeCookie(`${PREVIEW_COOKIE_PREFIX}id`, '', 0);
  writeCookie(`${PREVIEW_COOKIE_PREFIX}n`, '', 0);
  for (let index = 0; index < PREVIEW_COOKIE_MAX_CHUNKS; index += 1) {
    writeCookie(`${PREVIEW_COOKIE_PREFIX}${index}`, '', 0);
  }
}

export async function writePreviewCookies(
  id: string,
  document: Record<string, unknown>,
  operations: PreviewOperation[],
): Promise<void> {
  const trimmed = trimDocumentForPreview(document, operations);
  const payload = JSON.stringify({ id, document: trimmed, operations });
  const stream = new Blob([payload]).stream().pipeThrough(new CompressionStream('gzip'));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  const encoded = toBase64Url(compressed);
  const chunks: string[] = [];
  for (let index = 0; index < encoded.length; index += PREVIEW_COOKIE_CHUNK_SIZE) {
    chunks.push(encoded.slice(index, index + PREVIEW_COOKIE_CHUNK_SIZE));
  }
  if (chunks.length > PREVIEW_COOKIE_MAX_CHUNKS) {
    throw new Error(
      'This preview is too large to render on this host. Select fewer operations or a smaller document.',
    );
  }

  clearPreviewCookies();
  writeCookie(`${PREVIEW_COOKIE_PREFIX}id`, id, 1800);
  writeCookie(`${PREVIEW_COOKIE_PREFIX}n`, String(chunks.length), 1800);
  chunks.forEach((chunk, index) => {
    writeCookie(`${PREVIEW_COOKIE_PREFIX}${index}`, chunk, 1800);
  });
}
