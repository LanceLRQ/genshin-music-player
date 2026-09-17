import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allAssets } from '../src/testAssets/generators.ts';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outDir = join(scriptDir, '..', 'test-assets');

mkdirSync(outDir, { recursive: true });

const rows: string[] = [];
for (const asset of allAssets()) {
  const target = join(outDir, asset.fileName);
  writeFileSync(target, asset.bytes);
  rows.push(`  ${asset.fileName}（${asset.bytes.length} 字节）：${asset.description}`);
}

console.log(`已生成 ${rows.length} 个测试素材到 ${outDir}：`);
for (const row of rows) console.log(row);
