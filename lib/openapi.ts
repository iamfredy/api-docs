import { createOpenAPI } from 'fumadocs-openapi/server';
import path from 'path';
import fs from 'fs';

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

export const openapi = createOpenAPI({
  input: oasFiles,
});
