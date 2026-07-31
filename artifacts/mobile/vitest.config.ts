// Unit tests for the mobile app run under vitest with jsdom — they cover
// pure React logic (e.g. the AuthProvider), not native rendering.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/__tests__/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**'],
    environment: 'jsdom',
  },
});
