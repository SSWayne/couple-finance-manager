/**
 * 檢查 package-lock.json：所有套件的 resolved 網址都必須來自 https://registry.npmjs.org/，
 * 且都有 integrity。避免從其他 registry 或 git／本機路徑安裝。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const lock = JSON.parse(readFileSync(fileURLToPath(new URL('../package-lock.json', import.meta.url)), 'utf8'));
const problems = [];
let count = 0;
for (const [path, pkg] of Object.entries(lock.packages ?? {})) {
  if (!path || pkg.link) continue;
  count++;
  if (!pkg.resolved?.startsWith('https://registry.npmjs.org/')) problems.push(`${path}：resolved 不是 registry.npmjs.org（${pkg.resolved ?? '無'}）`);
  if (!pkg.integrity) problems.push(`${path}：缺少 integrity`);
}
if (problems.length) {
  console.error(`package-lock.json 檢查失敗（${problems.length} 項）：`);
  for (const p of problems.slice(0, 30)) console.error(`  - ${p}`);
  process.exit(1);
}
console.warn(`package-lock.json 檢查通過：${count} 個套件皆來自 registry.npmjs.org 且有 integrity`);
