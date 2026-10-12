import js from '@eslint/js';
import globals from 'globals';

const securityRules = {
  'no-console': ['error', { allow: ['warn', 'error'] }],
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-script-url': 'error',
  'no-restricted-properties': [
    'error',
    { property: 'innerHTML', message: '禁止使用 innerHTML，請用 h() 以 textContent 建立 DOM。' },
    { property: 'outerHTML', message: '禁止使用 outerHTML。' },
    { property: 'insertAdjacentHTML', message: '禁止使用 insertAdjacentHTML。' },
    { object: 'document', property: 'write', message: '禁止使用 document.write。' },
    { object: 'window', property: 'localStorage', message: '資料只存 IndexedDB，不使用 localStorage。' },
    { object: 'window', property: 'sessionStorage', message: '不使用 sessionStorage。' },
  ],
  'no-restricted-globals': [
    'error',
    { name: 'localStorage', message: '資料只存 IndexedDB，不使用 localStorage。' },
    { name: 'sessionStorage', message: '不使用 sessionStorage。' },
  ],
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
};

export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, __APP_VERSION__: 'readonly' },
    },
    rules: securityRules,
  },
  {
    files: ['tests/**/*.js', 'scripts/**/*.mjs', '*.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser, __APP_VERSION__: 'readonly' },
    },
    rules: securityRules,
  },
];
