import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { answerFileDialogs, budgetTotal, buildBudget, expect, launch, test } from './app';

test('builds a budget with a fringe; undo and redo', async ({ page }) => {
  await buildBudget(page);

  const line = page.getByRole('row', { name: /^Writer / });
  await expect(line).toContainText('50,000.00');
  await expect(line).toContainText('10.00%');
  await expect(page.getByRole('row', { name: /^Total Includes the fringes/ })).toContainText('55,000.00');

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(budgetTotal(page)).toHaveText('50,000.00');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(budgetTotal(page)).toHaveText('55,000.00');

  await page
    .getByRole('navigation', { name: 'Location in budget' })
    .getByRole('button', { name: 'Topsheet' })
    .click();
  await expect(page.getByRole('row', { name: /^Grand Total/ })).toContainText('55,000.00');
});

test('keeps the budget after quitting and reopening', async ({ home }) => {
  const first = await launch(home);
  await buildBudget(first.page);
  await expect(first.page.getByRole('contentinfo')).toContainText('Saved');
  await first.app.close();

  const second = await launch(home);
  try {
    await second.page.getByRole('button', { name: /^Test Show/ }).click();
    await expect(budgetTotal(second.page)).toHaveText('55,000.00');
  } finally {
    await second.app.close();
  }
});

test('saves the reports as a PDF', async ({ app, page, home }) => {
  await buildBudget(page);
  const file = join(home, 'Reports.pdf');
  await answerFileDialogs(app, file);

  await page.getByRole('button', { name: 'Reports' }).click();
  await page.getByRole('button', { name: 'Save PDF…' }).click();
  await expect.poll(() => existsSync(file)).toBe(true);
  expect(readFileSync(file).subarray(0, 5).toString()).toBe('%PDF-');
});

test('saves a version, with its PDF', async ({ page, home }) => {
  await buildBudget(page);

  await page.getByRole('button', { name: 'History' }).click();
  await page.getByRole('button', { name: 'Save version…' }).click();
  await page.getByPlaceholder('e.g. Studio draft').fill('Studio draft');
  await page.getByRole('button', { name: 'Save version', exact: true }).click();
  await expect(page.locator('main')).toContainText('Studio draft');

  const versions = join(home, 'Documents', 'Fringe Budgets', 'Test Show', 'versions');
  await expect
    .poll(() => existsSync(versions) && readdirSync(versions).some((f) => f.endsWith('.pdf')))
    .toBe(true);
});

test('exports a .fringe file that opens on another computer', async ({ app, page, home }) => {
  await buildBudget(page);
  const file = join(home, 'Test Show.fringe');
  await answerFileDialogs(app, file);
  await page.getByRole('button', { name: 'Export…' }).click();
  await expect.poll(() => existsSync(file)).toBe(true);

  // "Another computer": a second, empty install of Fringe.
  const elsewhere = join(home, 'elsewhere');
  const other = await launch(elsewhere);
  try {
    await answerFileDialogs(other.app, file);
    await other.page.getByRole('button', { name: /Import \.fringe file/ }).click();
    await expect(budgetTotal(other.page)).toHaveText('55,000.00');
  } finally {
    await other.app.close();
  }
});
