/**
 * Minimal ESLint config: correctness only, no style rules. TypeScript-side
 * dead code is already covered by tsc's strict + noUnusedLocals; the two
 * react-hooks rules are the real net — they keep effect dependency arrays and
 * hook call placement honest during component refactors.
 */
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    // Vendored declaration tree (upstream .d.ts copies), build artifacts,
    // and the CI workflow script are not linted.
    ignores: [
      '**/node_modules/**',
      '**/lib/**',
      '**/dist/**',
      'packages/typert-protocol/**',
      'packages/ui-billing/tests/fixtures/**',
      '.github/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Repository style accepts non-null assertions and structural casts
      // (both runtime families are read structurally), so the correctness
      // rules that would fight them stay off.
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      // `_`-prefixed parameters are the repository's explicit "unused by
      // contract" convention (runtime-family structural slices, injected
      // faces in tests).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
)
