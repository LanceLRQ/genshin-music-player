import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

/** 纯逻辑测试在 Node 环境运行（M1 的 src/core，以及 M4 会加入的 src/docs、src/testAssets） */
const NODE_TESTS = ['src/core/**/*.test.ts', 'src/docs/**/*.test.ts', 'src/testAssets/**/*.test.ts'];

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      exclude: ['src/core/**/*.test.ts', 'src/core/testing.ts'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
    projects: [
      {
        extends: true,
        test: { name: 'node', environment: 'node', include: NODE_TESTS },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: NODE_TESTS,
          setupFiles: ['src/test/setup.ts'],
        },
      },
    ],
  },
});
