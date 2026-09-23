import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/globalSetup.ts'],
    env: { DATABASE_URL: 'file:./test.db', NODE_ENV: 'test' },
    // One SQLite file shared by all test files.
    fileParallelism: false,
  },
});
