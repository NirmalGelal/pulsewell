import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    setupFiles: ['src/test/setup.ts'],
    globalSetup: 'src/test/global-setup.ts',
    include: ['src/**/*.test.ts'],
    exclude: [...(process.env.LIVE_LLM ? [] : ['src/**/*.live.test.ts']), 'node_modules/**'],
    env: {
      DATABASE_URL: 'file:./test.db',
      LOG_LEVEL: 'silent',
      LLM_MODE: 'mock',
      JWT_SECRET: 'test-secret-test-secret-test-secret-1234',
    },
  },
});
