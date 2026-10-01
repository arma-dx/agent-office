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

// Kural 1: tarayıcıya giden kod (apps/web ve packages/shared) sunucuya özel modüle ulaşamaz.
// Paket adıyla, göreli yolla ve dinamik içe aktarmayla gelen yolların hepsi kapatılır.
const SERVER_ONLY_MESSAGE =
  'Tarayıcıya giden kod sunucuya özel modül içe aktaramaz (CLAUDE.md kural 1). Veriyi API üzerinden alın.';
const SERVER_ONLY_PACKAGES = [
  '@supabase/*',
  '@anthropic-ai/*',
  '@agent-office/db',
  '@agent-office/db/*',
  'pg',
  'pg/*',
  'pg-boss',
  'pg-boss/*',
  'postgres',
  'postgres/*',
  'node:*',
];
// Göreli yolla api, worker, db ya da ortam şeması kaynağına inmek.
const SERVER_ONLY_RELATIVE = '(^|/)(apps/)?(api|worker)/src/|(^|/)packages/(db/|shared/src/env)';
const SERVER_ONLY_SPECIFIER =
  '^(@supabase\\/|@anthropic-ai\\/|@agent-office\\/(db|shared\\/env)(\\/|$)|pg(-boss)?(\\/|$)|postgres(\\/|$)|node:)';

/**
 * @param {boolean} webBlock
 * @returns {import('eslint').Linter.RulesRecord}
 */
function serverOnlyRules(webBlock) {
  return {
    'no-restricted-syntax': [
      'error',
      ...sharedRestrictedSyntax,
      {
        selector: `ImportExpression[source.value=/${SERVER_ONLY_SPECIFIER}/]`,
        message: SERVER_ONLY_MESSAGE,
      },
      {
        selector: `ImportExpression[source.value=/${SERVER_ONLY_RELATIVE.replaceAll('/', '\\/')}/]`,
        message: SERVER_ONLY_MESSAGE,
      },
      {
        selector: "ImportExpression[source.type!='Literal']",
        message: 'Dinamik içe aktarma sabit bir dizeyle yazılır; aksi hâlde kural 1 denetlenemez.',
      },
    ],
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: webBlock
              ? [...SERVER_ONLY_PACKAGES, '@agent-office/shared/env']
              : SERVER_ONLY_PACKAGES,
            message: SERVER_ONLY_MESSAGE,
          },
          { regex: SERVER_ONLY_RELATIVE, message: SERVER_ONLY_MESSAGE },
        ],
      },
    ],
  };
}

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
    rules: serverOnlyRules(true),
  },

  {
    // shared hem sunucuda hem tarayıcıda derlenir; ortam şeması ./env alt yolunda ayrı durur.
    name: 'agent-office/shared-browser-safe',
    files: ['packages/shared/src/**/*.ts'],
    rules: serverOnlyRules(false),
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
