import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `android/` is the Capacitor-generated native project: it holds copied/compiled web
  // build output (app/src/main/assets/public, app/build/**), not source to lint.
  globalIgnores(['dist', 'android']),
  {
    files: ['**/*.{js,jsx}'],
    ignores: ['backend/**'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    // The Vitest suite straddles both worlds: jsdom component tests reach for browser
    // globals, while the e2e and zip tests spawn child processes and handle Buffers.
    // Without the Node globals here, `Buffer` in tests/zip.test.js read as undefined and
    // the suite carried three permanent lint errors that trained the eye to ignore output.
    files: ['tests/**/*.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    // backend/server.js runs under Node, not the browser — it has no JSX and
    // needs Node globals (process, etc.) instead of window/document/navigator.
    files: ['backend/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
])
