/**
 * Exports the sample budget, Fringe Life, as the README links it: the project as a .fringe file,
 * and its reports as a PDF and an Excel workbook, in docs/sample/. It opens the copy a first
 * launch adds, and saves each file the way a user would. Build the app first, then run
 * `npx playwright test --config scripts/sample-files/playwright.config.ts`.
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerFileDialogs, expect, test } from '../../e2e/app';

const OUT = fileURLToPath(new URL('../../docs/sample/', import.meta.url));

test('sample budget files', async ({ app, page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.getByRole('button', { name: /^Fringe Life/ }).click();
  await expect(page.getByRole('contentinfo')).toContainText('Saved');

  const save = async (name: string, button: string) => {
    const file = join(OUT, name);
    rmSync(file, { force: true });
    await answerFileDialogs(app, file);
    await page.getByRole('button', { name: button }).click();
    await expect.poll(() => existsSync(file), { timeout: 30_000 }).toBe(true);
  };
  await save('fringe-life.fringe', 'Export…');
  await page.getByRole('button', { name: 'Reports' }).click();
  await save('fringe-life.pdf', 'Save PDF…');
  await save('fringe-life.xlsx', 'Save Excel…');
});
