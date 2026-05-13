import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Fetch-on-mount and fetch-on-deps-change patterns inherently call
      // setState inside useEffect (loading flag, data, error). The
      // alternative ("don't sync external state via effects") doesn't fit
      // this app, which has PocketBase as the source of truth. We accept
      // the cascading-render warning as the price of straightforward
      // data fetching.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
])
