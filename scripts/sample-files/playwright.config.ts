import { defineConfig } from '@playwright/test';

// Exports the sample budget's files (docs/sample) from the built app: npm run build first, then
// npx playwright test --config scripts/sample-files/playwright.config.ts
export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: 'list',
});
