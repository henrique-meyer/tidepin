import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['dist/', 'coverage/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['src/server/**', 'src/shared/**', 'test/**', '*.config.*'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/client/**'],
    languageOptions: { globals: globals.browser },
  },
);
