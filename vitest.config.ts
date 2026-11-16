import { defineConfig } from 'vitest/config';

// Tests use their own config so that running them never starts Electron
// (vite.config.ts launches the desktop app as part of the dev server).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
