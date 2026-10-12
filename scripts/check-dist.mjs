/**
 * 建置後檢查：dist/index.html 的所有資源都在 BASE_PATH 子路徑下、且注入了 CSP meta、
 * 沒有任何外部網址（CDN、遠端字型）。用法：BASE_PATH=/repo/ node scripts/check-dist.mjs
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = (() => {
  let b = (process.env.BASE_PATH || '/').trim();
  if (!b.startsWith('/')) b = `/${b}`;
  if (!b.endsWith('/')) b += '/';
  return b;
})();

const distDir = fileURLToPath(new URL('../dist/', import.meta.url));
const indexPath = join(distDir, 'index.html');
const problems = [];

if (!existsSync(indexPath)) {
  console.error('找不到 dist/index.html，請先執行 npm run build');
  process.exit(1);
}
// Vite 會把屬性中的單引號轉成 &#39;，先解碼再檢查
const html = readFileSync(indexPath, 'utf8').replaceAll('&#39;', "'");

if (!/<meta[^>]+http-equiv="Content-Security-Policy"/i.test(html)) problems.push('缺少 CSP meta');
if (/'unsafe-inline'|'unsafe-eval'/.test(html)) problems.push("CSP 含有 'unsafe-inline' 或 'unsafe-eval'");

const refs = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
for (const ref of refs) {
  if (ref.startsWith('data:') || ref.startsWith('#')) continue;
  if (/^(https?:)?\/\//i.test(ref)) problems.push(`index.html 引用外部網址：${ref}`);
  else if (!ref.startsWith(base)) problems.push(`資源不在子路徑 ${base} 下：${ref}`);
  else {
    const local = join(distDir, decodeURIComponent(ref.slice(base.length)));
    if (!existsSync(local)) problems.push(`資源檔案不存在：${ref}`);
  }
}
if (!/<script[^>]+type="module"/.test(html)) problems.push('找不到 module script');
if (/<script(?![^>]*\bsrc=)[^>]*>[^<]+<\/script>/i.test(html)) problems.push('index.html 含有 inline script（違反 CSP）');

// 掃描所有 CSS/JS，確認沒有遠端字型或 CDN
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(css|js)$/.test(name)) {
      const text = readFileSync(p, 'utf8');
      const hit = text.match(/url\(\s*["']?(https?:)?\/\/[^)]+\)/i) || text.match(/fonts\.googleapis|cdn\.jsdelivr|unpkg\.com|cdnjs/i);
      if (hit) problems.push(`${name} 含有外部資源：${hit[0].slice(0, 80)}`);
    }
  }
}
walk(distDir);

if (problems.length) {
  console.error(`dist 檢查失敗（BASE_PATH=${base}）：`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.warn(`dist 檢查通過（BASE_PATH=${base}，${refs.length} 個資源，CSP 已注入）`);
