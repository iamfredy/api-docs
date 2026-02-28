import { generateFiles } from 'fumadocs-openapi';
import { createOpenAPI } from 'fumadocs-openapi/server';
import fs from 'fs';
import path from 'path';

async function main() {
  const oasDir = path.resolve(process.cwd(), 'oas');

  const oasFiles = fs
    .readdirSync(oasDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.resolve(oasDir, f));

  console.log(`Found ${oasFiles.length} OAS file(s):`, oasFiles.map(f => path.basename(f)));

  const openapi = createOpenAPI({
    input: oasFiles,
  });

  await generateFiles({
    input: openapi,
    output: './content/docs',
    per: 'operation',
    groupBy: 'tag',
  });

  console.log('✓ Done');
}

main().catch((err) => {
  console.error('Generation failed:', err);
  process.exit(1);
});
