import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.js'],
    exclude: ['tests/browser/**'],
    setupFiles: ['tests/setup.js'],
    testTimeout: 10000,
  },
});
