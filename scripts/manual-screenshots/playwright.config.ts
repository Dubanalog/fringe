import { defineConfig } from '@playwright/test';

// Takes the manual's screenshots (docs/images) from the built app: npm run build first, then
// npx playwright test --config scripts/manual-screenshots/playwright.config.ts
export default defineConfig({
  testDir: '.',
  timeout: 180_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: 'list',
});
