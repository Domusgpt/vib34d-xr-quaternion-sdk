import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'tests/',
        'dist/',
        '**/*.config.js',
        '**/types/**',
        'DOCS/',
        'examples/',
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60,
      },
    },
    setupFiles: ['./tests/setup.js'],
    testTimeout: 10000,
    include: ['tests/**/*.test.js', 'tests/**/*.spec.js'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
});
