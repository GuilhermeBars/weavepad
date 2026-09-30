import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import nextPlugin from '@next/eslint-plugin-next';
import { fileURLToPath } from 'node:url';
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '.pglite/**',
      '.npm-cache/**',
      '.codex-logs/**',
      '**/next-env.d.ts',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  // Next.js detects the plugin by inspecting this config file, not an app file.
  { plugins: { '@next/next': nextPlugin } },
  {
    files: ['apps/web/**/*.{js,mjs,ts,tsx}'],
    settings: { next: { rootDir: fileURLToPath(new URL('./apps/web/', import.meta.url)) } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
);
