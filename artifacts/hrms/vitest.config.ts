// Standalone vitest config: the app's vite.config.ts requires a PORT env var
// (dev-server concern) that unit tests don't need, so tests use this instead.
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
