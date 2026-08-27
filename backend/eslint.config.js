import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'abis/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Money is bigint. A float operation on a base-unit value is a defect, not a style choice.
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: 'No floats in financial code. Use bigint and lib/decimal.ts.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'round', message: 'No float rounding in financial code.' },
        { object: 'Number', property: 'parseFloat', message: 'No floats in financial code.' },
      ],
    },
  },
  {
    files: ['test/**/*.ts', 'scripts/**/*.mjs'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
