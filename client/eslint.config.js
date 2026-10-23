// ESLint flat config — correctness-focused. Formatting is Prettier's job
// (eslint-config-prettier switches every stylistic rule off), so anything
// this file flags is a real code-quality issue, not taste. Tuned for
// LLM-written code: the enabled extras catch the classic slips — unused
// imports/vars, loose equality, shadowed names — plus the two React
// mistakes that cause real, hard-to-see bugs (hooks called conditionally,
// and effects with incomplete dependency arrays).
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  reactHooks.configs.flat.recommended,
  prettier,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // `react-hooks` recommended (enabled above) brings the full React
      // Compiler rule set — purity, refs, set-state-in-effect and friends.
      // Keep it: those catch real bugs, and the ported code passes clean.
      //
      // These two get promoted from warn to error because they are the
      // classic React mistakes. `rules-of-hooks` catches a hook behind an
      // if/early-return, which corrupts hook order and produces nonsense
      // state. `exhaustive-deps` catches the stale-closure effect, which
      // silently reads yesterday's value.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      // Unused code is the #1 LLM residue. Underscore-prefix to opt out.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // == coerces; === says what you mean.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      // A shadowed name is a bug waiting for a refactor.
      'no-shadow': 'off',
      '@typescript-eslint/no-shadow': 'error',
      // Leftover debug logging shouldn't ship silently.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    ignores: ['dist/', 'public/'],
  },
);
