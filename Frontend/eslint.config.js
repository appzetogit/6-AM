import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

/**
 * ESLint 9 flat config.
 *
 * `npm run lint` was already in package.json but there was no config file, so
 * the command failed on every run and nothing was ever linted. This is the
 * missing half, kept deliberately close to the Vite React default: correctness
 * rules on, style opinions off, so it can be switched on over an existing
 * codebase without a thousand-line reformat.
 *
 * Rules that would fail today across many files are set to "warn" rather than
 * "error", so CI reports them without blocking. Tighten to "error" once the
 * existing warnings are worked down.
 */
export default [
  {
    ignores: ['dist/**', 'build/**', 'node_modules/**', 'public/**', '*.cjs', 'scripts/**'],
  },
  {
    // Config and tooling files run in Node, not the browser, so `process` and
    // `require` are defined there and nowhere else.
    files: ['vite.config.js', 'eslint.config.js', '*.config.js', 'fix_admin_router.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.es2021 },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      /**
       * eslint-plugin-react-hooks v7 ships a new class of rule — purity,
       * immutability, set-state-in-effect, static-components, refs — that fires
       * ~550 times across this codebase. They describe real smells, but they
       * are new opinions applied retroactively, not defects found in review, so
       * they report as warnings. Promote one to "error" as its count reaches
       * zero; that is what stops it coming back.
       */
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      // Calling a hook conditionally genuinely breaks React, so this one stays fatal.
      'react-hooks/rules-of-hooks': 'error',

      // Unused names are usually leftovers, but the codebase has many and they
      // are harmless; report without failing. `_`-prefixed names and caught
      // errors are intentional throwaways.
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^[_A-Z]',
        caughtErrors: 'none',
        ignoreRestSiblings: true,
      }],

      // These two fire on patterns that are deliberate here.
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-undef': 'error',

      'react-refresh/only-export-components': 'off',
    },
  },
]
