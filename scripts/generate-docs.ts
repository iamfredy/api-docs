import { generateFiles } from 'fumadocs-openapi';
import { createOpenAPI } from 'fumadocs-openapi/server';
import fs from 'fs';
import path from 'path';

function stripPatterns(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(stripPatterns);
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k === 'pattern') continue;
    result[k] = stripPatterns(v);
  }
  return result;
}

async function main() {
  const oasDir = path.resolve(process.cwd(), 'oas');
  const outputDir = path.resolve(process.cwd(), 'content/docs');

  const oasFiles = fs
    .readdirSync(oasDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.resolve(oasDir, f));

  console.log(`Found ${oasFiles.length} OAS file(s)`);

  // --- Clean up orphaned generated MDX files ---
  // Multiple OAS files can share the same tag (and thus the same output folder),
  // so we must clean up at the file level, not folder level.
  const metaPath = path.join(outputDir, 'meta.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  const staticPages = new Set<string>(meta.pages ?? []);

  // Build set of existing OAS filenames (e.g. "oas/Account.json")
  const existingOasFiles = new Set(
    oasFiles.map((f) => 'oas/' + path.basename(f))
  );

  const existingDirs = fs
    .readdirSync(outputDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  let cleanedFiles = 0;
  let cleanedDirs = 0;
  for (const dir of existingDirs) {
    if (staticPages.has(dir)) continue; // protected manual folder

    const dirPath = path.join(outputDir, dir);
    const mdxFiles = fs.readdirSync(dirPath).filter((f) => f.endsWith('.mdx'));

    for (const mdxFile of mdxFiles) {
      const mdxPath = path.join(dirPath, mdxFile);
      const content = fs.readFileSync(mdxPath, 'utf-8');
      // Match document={"oas/SomeFile.json"} in generated MDX
      const docMatch = content.match(/document=\{"(oas\/[^"]+)"\}/);
      if (docMatch && !existingOasFiles.has(docMatch[1])) {
        fs.rmSync(mdxPath);
        console.log(`Removed orphaned file: ${dir}/${mdxFile} (referenced ${docMatch[1]})`);
        cleanedFiles++;
      }
    }

    // Remove the directory if it's now empty
    const remaining = fs.readdirSync(dirPath);
    if (remaining.length === 0) {
      fs.rmSync(dirPath, { recursive: true });
      console.log(`Removed empty folder: ${dir}`);
      cleanedDirs++;
    }
  }
  if (cleanedFiles > 0 || cleanedDirs > 0) {
    console.log(`Cleaned ${cleanedFiles} orphaned file(s), ${cleanedDirs} empty folder(s)`);
  }

  // Suppress noisy openapi-sampler warnings about allOf type conflicts.
  // These are harmless — openapi-sampler resolves them by using the last type.
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes("schemas with different types can't be merged")) {
      return;
    }
    originalWarn.apply(console, args);
  };

  let succeeded = 0;
  let skipped = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const filePath of oasFiles) {
    const fileName = path.basename(filePath);
    const apiName = path.basename(filePath, '.json').toLowerCase().replace(/\s+/g, '-');
    const outputPath = path.join(outputDir, apiName);

    if (fs.existsSync(outputPath)) {
      const oasStat = fs.statSync(filePath);
      const outStat = fs.statSync(outputPath);
      if (outStat.mtimeMs > oasStat.mtimeMs) {
        skipped++;
        continue;
      }
    }

  try {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const cleaned = stripPatterns(raw);
  fs.writeFileSync(filePath, JSON.stringify(cleaned, null, 2));
  const relPath = path.relative(process.cwd(), filePath);
  const openapi = createOpenAPI({ input: [relPath] });
  await generateFiles({
    input: openapi,
    output: './content/docs',
    per: 'operation',
    groupBy: 'tag',
  });
  succeeded++;
} 
 catch (err) {
      failed++;
      failures.push(fileName);
      console.warn(`⚠ Skipped ${fileName}: ${(err as Error).message}`);
    }
  }

  // Restore original console.warn
  console.warn = originalWarn;

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
