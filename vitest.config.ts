import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { preserveSymlinks: true },
  test: {
    maxWorkers: 1,
    projects: [
      {
        resolve: { preserveSymlinks: true },
        test: { name: 'web', include: ['apps/web/lib/**/*.test.ts'] },
      },
      {
        resolve: { preserveSymlinks: true },
        test: { name: 'shared', include: ['packages/shared/src/**/*.test.ts'] },
      },
      {
        resolve: { preserveSymlinks: true },
        test: { name: 'sync-server', include: ['apps/sync-server/src/**/*.test.ts'] },
      },
    ],
  },
});
