import { createOpenAPI } from 'fumadocs-openapi/server';
import path from 'path';
import fs from 'fs';

const oasDir = path.resolve(process.cwd(), 'oas');

const oasFiles = fs
  .readdirSync(oasDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => path.resolve(oasDir, f));

export const openapi = createOpenAPI({
  input: oasFiles,
});
