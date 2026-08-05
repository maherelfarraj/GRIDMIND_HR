import js from '@eslint/js';
import tsPlugin from 'typescript-eslint';

/**
 * Package-local ESLint config for artifacts/hrms.
 *
 * PRIMARY PURPOSE: prevent pages and components from importing apiFetch
 * directly from @/lib/api (or via relative path). All typed API calls must go
 * through @workspace/api-client-react hooks/bare-functions. The only
 * legitimate consumer of apiFetch is @/lib/unspecced-api (exempted below).
 */
export default tsPlugin.config(
  js.configs.recommended,
  ...tsPlugin.configs.recommended,
  {
    rules: {
      // Relax TypeScript strictness — this codebase uses `any` deliberately
      // in places where the generated-client types don't perfectly match the
      // local interface shapes.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],

      // ─── GUARD: block direct use of apiFetch / ApiFetchOptions outside
      //     the one file that legitimately needs them. ─────────────────────
      //
      // IMPORTANT: We block only the named exports apiFetch / ApiFetchOptions
      // from @/lib/api. Other auth-infrastructure exports from that module
      // (configureApiClient, handleSessionExpired, PASSWORD_CHANGE_REQUIRED_EVENT,
      // isSessionExpiry401, …) are legitimate and must remain importable.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            // Block the @/ alias form
            {
              name: '@/lib/api',
              importNames: ['apiFetch', 'ApiFetchOptions'],
              message:
                'Use @workspace/api-client-react hooks or helpers from @/lib/unspecced-api instead of importing apiFetch directly.',
            },
            // Block common relative forms
            {
              name: '../lib/api',
              importNames: ['apiFetch', 'ApiFetchOptions'],
              message:
                'Use @workspace/api-client-react hooks or helpers from @/lib/unspecced-api instead of importing apiFetch directly.',
            },
            {
              name: '../../lib/api',
              importNames: ['apiFetch', 'ApiFetchOptions'],
              message:
                'Use @workspace/api-client-react hooks or helpers from @/lib/unspecced-api instead of importing apiFetch directly.',
            },
          ],
        },
      ],
    },
  },
  {
    // lib/unspecced-api.ts is the sole legitimate consumer of apiFetch.
    // lib/api.ts itself defines apiFetch — both are exempted.
    files: ['src/lib/unspecced-api.ts', 'src/lib/api.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    // Test files may import whatever they need.
    files: ['src/**/__tests__/**', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
);
