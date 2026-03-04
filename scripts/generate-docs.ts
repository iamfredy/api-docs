import { generateFiles } from 'fumadocs-openapi';
import { createOpenAPI } from 'fumadocs-openapi/server';
import fs from 'fs';
import path from 'path';

async function main() {
  const oasDir = path.resolve(process.cwd(), 'oas');
  const outputDir = path.resolve(process.cwd(), 'content/docs');

  const oasFiles = fs
    .readdirSync(oasDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.resolve(oasDir, f));

  console.log(`Found ${oasFiles.length} OAS file(s)`);

  let succeeded = 0;
  let skipped = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const filePath of oasFiles) {
    const fileName = path.basename(filePath);
    const apiName = path.basename(filePath, '.json').toLowerCase().replace(/\s+/g, '-');
    const outputPath = path.join(outputDir, apiName);

    // Skip if already generated and OAS file hasn't changed
    if (fs.existsSync(outputPath)) {
      const oasStat = fs.statSync(filePath);
      const outStat = fs.statSync(outputPath);
      if (outStat.mtimeMs > oasStat.mtimeMs) {
        skipped++;
        continue;
      }
    }

    try {
const relPath = path.relative(process.cwd(), filePath);
const openapi = createOpenAPI({ input: [relPath] });

      await generateFiles({
        input: openapi,
        output: './content/docs',
        per: 'operation',
        groupBy: 'tag',
      });
      succeeded++;
    } catch (err) {
      failed++;
      failures.push(fileName);
      console.warn(`⚠ Skipped ${fileName}: ${(err as Error).message}`);
    }
  }

  console.log(`\n✓ Done — ${succeeded} generated, ${skipped} skipped, ${failed} failed`);
  if (failures.length > 0) {
    console.warn('Failed files:');
    failures.forEach((f) => console.warn(`  - ${f}`));
  }
}

main().catch((err) => {
  console.error('Generation failed:', err);
  process.exit(1);
});
