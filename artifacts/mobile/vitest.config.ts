// Unit tests for the mobile app run under vitest with jsdom — they cover
// pure React logic (e.g. the AuthProvider), not native rendering.
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    // expo-modules-core references __DEV__ at module load; define it for the
    // jsdom test environment so the import doesn't crash with ReferenceError.
    __DEV__: 'false',
  },
  resolve: {
    alias: [
      // Static image assets resolve to a stub under vitest.
      { find: /\.(png|jpg|jpeg|gif|webp)$/, replacement: path.resolve(__dirname, 'test/file-stub.cjs') },
      { find: '@', replacement: path.resolve(__dirname, '.') },
    ],
  },
  test: {
    include: ['**/__tests__/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**'],
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
  },
});
