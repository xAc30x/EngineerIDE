import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import electron from 'vite-plugin-electron/simple';

/**
 * Content Security Policy for the packaged renderer: only files shipped with
 * the app may load, and the renderer cannot open network connections itself.
 */
const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

/**
 * The Vite dev server needs two extra allowances: an inline script (React
 * Fast Refresh) and a WebSocket connection (hot module reload).
 */
const DEVELOPMENT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' ws://localhost:* ws://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

/** Adds the Content-Security-Policy meta tag to index.html. */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'engineer-ide:content-security-policy',
    transformIndexHtml(_html, context) {
      const isDevServer = context.server !== undefined;
      return [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: isDevServer ? DEVELOPMENT_CSP : PRODUCTION_CSP,
          },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    contentSecurityPolicy(),
    electron({
      // Built to dist-electron/main.js (ES module, see "main" in package.json).
      // The storage worker (Phase 3b) is its own file, storage-worker.js,
      // because a worker thread starts from a file; `node:sqlite` stays an
      // import, like every Node built-in.
      main: {
        entry: {
          main: 'electron/main.ts',
          'storage-worker': 'electron/storage/worker.ts',
        },
      },
      // Built to dist-electron/preload.cjs. Sandboxed preload scripts must be
      // CommonJS, so the file extension states that explicitly.
      preload: {
        input: 'electron/preload.ts',
        vite: {
          build: {
            rolldownOptions: {
              output: {
                entryFileNames: '[name].cjs',
                chunkFileNames: '[name].cjs',
              },
            },
          },
        },
      },
    }),
  ],
});
