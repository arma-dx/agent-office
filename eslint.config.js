// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// DİKKAT: Bir kural seçenekleriyle yeniden yazılırsa önceki bloğun (ya da hazır ayarın)
// seçenekleri birleşmez, tamamen ezilir. no-restricted-syntax ve restrict-template-expressions
// bu yüzden aşağıda eksiksiz yazılır; ortak seçiciler tek dizide tutulup her bloğa yayılır.

// U+2014 kaçış dizisiyle yazılır; bu dosya kendi kuralına takılmaz.
const EM_DASH_MESSAGE =
  'Uzun tire (U+2014) kullanılmaz; kısa tire, virgül ya da iki nokta kullanın.';
const JS_EXTENSION_MESSAGE =
  'Göreli içe aktarma .ts uzantısıyla yazılır; Node .js uzantısını .ts dosyasına çözmez.';
const RELATIVE_JS = '[source.value=/^\\.{1,2}\\/.*\\.js$/]';

const sharedRestrictedSyntax = [
  { selector: 'Literal[value=/\\u2014/]', message: EM_DASH_MESSAGE },
  { selector: 'TemplateElement[value.cooked=/\\u2014/]', message: EM_DASH_MESSAGE },
  { selector: 'JSXText[value=/\\u2014/]', message: EM_DASH_MESSAGE },
  { selector: `ImportDeclaration${RELATIVE_JS}`, message: JS_EXTENSION_MESSAGE },
  { selector: `ExportNamedDeclaration${RELATIVE_JS}`, message: JS_EXTENSION_MESSAGE },
  { selector: `ExportAllDeclaration${RELATIVE_JS}`, message: JS_EXTENSION_MESSAGE },
  { selector: `ImportExpression${RELATIVE_JS}`, message: JS_EXTENSION_MESSAGE },
];

const SERVER_ONLY_MESSAGE =
  'apps/web sunucuya özel modül içe aktaramaz (CLAUDE.md kural 1). Veriyi API üzerinden alın.';
const SERVER_ONLY_DYNAMIC =
  'ImportExpression[source.value=/^(@supabase\\/|@anthropic-ai\\/|@agent-office\\/db(\\/|$)|pg(-boss)?(\\/|$)|postgres(\\/|$)|node:)/]';

export default defineConfig([
  globalIgnores([
    '**/dist/',
    '**/coverage/',
    '**/.vite/',
    '**/.vitest/',
    'supabase/.temp/',
    'supabase/.branches/',
  ]),

  {
    name: 'agent-office/base',
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'no-restricted-syntax': ['error', ...sharedRestrictedSyntax],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allowAny: false,
          allowBoolean: false,
          allowNever: false,
          allowNullish: false,
          allowRegExp: false,
          allowNumber: true,
        },
      ],
    },
  },

  {
    name: 'agent-office/js-files-no-type-info',
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  {
    name: 'agent-office/node',
    files: ['apps/api/**', 'apps/worker/**', 'packages/db/**', '*.{js,ts}', '**/*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },

  {
    name: 'agent-office/web',
    files: ['apps/web/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
    rules: {
      'no-restricted-syntax': [
        'error',
        ...sharedRestrictedSyntax,
        { selector: SERVER_ONLY_DYNAMIC, message: SERVER_ONLY_MESSAGE },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@supabase/*',
                '@anthropic-ai/*',
                '@agent-office/db',
                '@agent-office/db/*',
                '@agent-office/shared/env',
                'pg',
                'pg/*',
                'pg-boss',
                'pg-boss/*',
                'postgres',
                'postgres/*',
                'node:*',
              ],
              message: SERVER_ONLY_MESSAGE,
            },
          ],
        },
      ],
    },
  },

  {
    name: 'agent-office/tests',
    files: ['**/*.test.{ts,tsx}', '**/test/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  prettier,
]);
