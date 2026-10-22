import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  test as base,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const main = resolve(fileURLToPath(import.meta.url), '../../apps/desktop/out/main/index.js');

/** Starts the built app with FRINGE_TEST_HOME as its settings and Documents folder. */
export async function launch(home: string): Promise<{ app: ElectronApplication; page: Page }> {
  // The dev server's URL and ELECTRON_RUN_AS_NODE would make it something other than the built app.
  const skip = new Set(['ELECTRON_RENDERER_URL', 'ELECTRON_RUN_AS_NODE']);
  const env: Record<string, string> = { FRINGE_TEST_HOME: home };
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !skip.has(key)) env[key] ??= value;
  }
  const app = await electron.launch({ args: [main], env });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

/** Each test gets a throwaway folder and, unless it launches its own, a running app. */
export const test = base.extend<{ home: string; app: ElectronApplication; page: Page }>({
  // eslint-disable-next-line no-empty-pattern
  home: async ({}, use) => {
    const home = mkdtempSync(join(tmpdir(), 'fringe-e2e-'));
    await use(home);
    rmSync(home, { recursive: true, force: true, maxRetries: 5 });
  },
  app: async ({ home }, use) => {
    const { app } = await launch(home);
    await use(app);
    await app.close();
  },
  page: async ({ app }, use) => {
    await use(await app.firstWindow());
  },
});

export { expect };

/** The native Save and Open dialogs can't be clicked, so they answer with this file instead. */
export async function answerFileDialogs(app: ElectronApplication, file: string): Promise<void> {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog;
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [filePath],
    })) as typeof dialog.showOpenDialog;
  }, file);
}

/** Presses keys and types text in turn, as someone working the grid from the keyboard would. */
export async function keys(page: Page, ...steps: string[]): Promise<void> {
  for (const step of steps) {
    if (/^(Tab|Enter|Escape|(Control|Shift)\+\w+)$/.test(step)) await page.keyboard.press(step);
    else await page.keyboard.type(step);
  }
}

/** The budget total in the status bar. */
export const budgetTotal = (page: Page) => page.getByRole('contentinfo').locator('strong');

/**
 * Builds "Test Show": a 10% Payroll fringe, category 1100 Story, account 1101 Writers and one line,
 * Writer 10 weeks at 5,000 with the fringe. That's 50,000 plus 5,000 fringe: 55,000.
 */
export async function buildBudget(page: Page): Promise<void> {
  await page.getByPlaceholder('Name it after the show').fill('Test Show');
  await page.getByRole('button', { name: 'Create' }).click();

  await page.getByRole('button', { name: 'Budget Settings' }).click();
  await page.getByRole('tab', { name: 'Fringes' }).click();
  await page.getByRole('textbox', { name: 'New fringe name' }).fill('Payroll');
  await page.getByRole('button', { name: 'Add Fringe' }).click();
  await page.getByRole('textbox', { name: 'Rate of Payroll' }).fill('10');
  await page.getByRole('textbox', { name: 'Rate of Payroll' }).press('Enter');

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Budget', exact: true })
    .click();
  await page.getByRole('button', { name: /No categories yet/ }).click();
  await keys(page, '1100', 'Tab', 'Story', 'Enter', 'Control+Enter');
  await page.getByRole('button', { name: /No accounts yet/ }).click();
  await keys(page, '1101', 'Tab', 'Writers', 'Enter', 'Control+Enter');
  await page.getByRole('button', { name: /No detail lines yet/ }).click();
  await keys(page, 'Writer', 'Tab', '10', 'Tab', 'week', 'Tab', 'Tab', '5000', 'Enter');
  await expect(budgetTotal(page)).toHaveText('50,000.00');

  await page.getByRole('checkbox', { name: 'Payroll on this line' }).check();
  await expect(budgetTotal(page)).toHaveText('55,000.00');
}
