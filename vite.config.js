import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/**
 * 部署子路徑：GitHub Pages 為 /REPO/，由環境變數 BASE_PATH 決定。
 * 未設定時用 '/'（本機開發）。一律補齊前後斜線。
 */
function resolveBase() {
  const raw = (process.env.BASE_PATH || '/').trim();
  let base = raw.startsWith('/') ? raw : `/${raw}`;
  if (!base.endsWith('/')) base += '/';
  return base;
}

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "worker-src 'none'",
  "manifest-src 'self'",
].join('; ');

/** 只在建置時注入 CSP meta；開發模式（HMR 需要 inline/ws）不注入。 */
function cspPlugin() {
  return {
    name: 'couple-finance-csp',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

export default defineConfig({
  base: resolveBase(),
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [cspPlugin()],
  build: {
    // 不把小資源轉成 inline data URI 以外的形式；字型、圖示都打包進 dist
    assetsInlineLimit: 0,
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.js'],
  },
});
