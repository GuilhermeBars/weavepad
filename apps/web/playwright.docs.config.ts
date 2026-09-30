import { defineConfig } from '@playwright/test';
import config from './playwright.config';

export default defineConfig(config, {
  testMatch: '**/docs/*.docs.ts',
  testIgnore: [],
  timeout: 90000,
  retries: 0,
  use: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
});
