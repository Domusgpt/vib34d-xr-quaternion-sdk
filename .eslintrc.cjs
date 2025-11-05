module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    // Allow console for warnings and errors
    'no-console': ['warn', { allow: ['warn', 'error'] }],

    // Enforce consistent code style
    // Note: indent rule disabled temporarily due to inconsistent codebase formatting
    'indent': 'off', // TODO: Re-enable after running prettier
    'linebreak-style': 'off', // Disabled for cross-platform compatibility
    'quotes': ['warn', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
    'semi': ['warn', 'always'],

    // Best practices
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-undef': 'error',
    'no-var': 'error',
    'prefer-const': 'warn',
    'prefer-arrow-callback': 'warn',

    // Relaxed rules for flexibility
    'no-prototype-builtins': 'off',
  },
  overrides: [
    {
      // Test files can have different rules
      files: ['tests/**/*.js', '**/*.test.js', '**/*.spec.js', '**/*.e2e.js'],
      env: {
        node: true,
      },
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
        test: 'readonly',
      },
      rules: {
        'no-unused-expressions': 'off',
        'no-undef': 'off', // Vitest and Playwright globals
      },
    },
  ],
  ignorePatterns: [
    'dist/',
    'node_modules/',
    'coverage/',
    'playwright-report/',
    '*.min.js',
  ],
};
