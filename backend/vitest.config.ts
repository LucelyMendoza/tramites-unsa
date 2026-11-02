import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 60000,
    pool: 'forks',
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/._*'],
  },
});
