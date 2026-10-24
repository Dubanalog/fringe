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

test('fringes posted to a production level still show on their category, greyed', async ({ page }) => {
  await buildBudget(page);
  await page.getByRole('button', { name: 'Budget Settings' }).click();
  await page.getByRole('tab', { name: 'Fringes' }).click();
  await page.getByRole('radio', { name: /One account per production level/ }).check();
  await page.getByRole('button', { name: 'Budget', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Location in budget' })
    .getByRole('button', { name: 'Topsheet' })
    .click();

  await expect(page.getByRole('row', { name: /1100 Story/ })).toContainText('5,000.00 → ');
  await expect(page.getByRole('row', { name: /1100 Story/ })).toContainText('50,000.00');
  await expect(page.getByRole('row', { name: /^Grand Total/ })).toContainText('55,000.00');

  // The reports show them under the level, with how they add up.
  await page.getByRole('button', { name: 'Reports' }).click();
  const report = page.frameLocator('iframe').locator('body');
  await expect(report).toContainText('Above-The-Line Fringes');
  await expect(report).toContainText('Payroll 10% of 50,000.00');
});

test("posting to each category's fringe account adds the missing account", async ({ page }) => {
  await buildBudget(page);
  await page.getByRole('button', { name: 'Budget Settings' }).click();
  await page.getByRole('tab', { name: 'Fringes' }).click();
  await page.getByRole('radio', { name: /One account per category/ }).check();
  await expect(page.getByText(/have fringes but no account|has fringes but no account/)).toHaveCount(0);

  await page.getByRole('button', { name: 'Budget', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Location in budget' })
    .getByRole('button', { name: '1100 Story' })
    .click();
  await expect(page.getByRole('row', { name: /1199 Total Fringes/ })).toContainText('5,000.00');
  await expect(budgetTotal(page)).toHaveText('55,000.00');

  // 1199 shows how its fringes add up, and so does the report.
  await page
    .getByRole('row', { name: /1199 Total Fringes/ })
    .getByRole('button')
    .first()
    .click();
  const breakdown = page.getByRole('table', { name: 'Fringe breakdown' });
  await expect(page.getByRole('heading', { name: 'Fringes from 1101' })).toBeVisible();
  await expect(breakdown.getByRole('row', { name: /^Payroll/ })).toContainText('10%');
  await expect(breakdown.getByRole('row', { name: /^Payroll/ })).toContainText('50,000.00');
  await expect(breakdown.getByRole('row', { name: /^Payroll/ })).toContainText('5,000.00');
  await page.getByRole('button', { name: 'Reports' }).click();
  await expect(page.frameLocator('iframe').locator('body')).toContainText('Payroll 10% of 50,000.00');
});

test('renames a budget from its tab, F2 and Budget Settings', async ({ page }) => {
  await buildBudget(page);
  const tabs = page.getByRole('tablist', { name: 'Open budgets' });

  await tabs.getByRole('tab', { name: /^Test Show/ }).dblclick();
  await page.getByRole('textbox', { name: 'Budget name' }).fill('Night Shift');
  await page.keyboard.press('Enter');
  await expect(tabs.getByRole('tab', { name: /^Night Shift/ })).toBeVisible();

  await tabs.getByRole('tab', { name: /^Night Shift/ }).focus();
  await page.keyboard.press('F2');
  await page.getByRole('textbox', { name: 'Budget name' }).fill('Day Shift');
  await page.keyboard.press('Enter');
  await expect(tabs.getByRole('tab', { name: /^Day Shift/ })).toBeVisible();

  await page.getByRole('button', { name: 'Budget Settings' }).click();
  await page.getByRole('tab', { name: 'General' }).click();
  const field = page.getByRole('textbox', { name: 'Budget name' });
  await expect(field).toHaveValue('Day Shift');
  await field.fill('Swing Shift');
  await field.press('Enter');
  await expect(tabs.getByRole('tab', { name: /^Swing Shift/ })).toBeVisible();
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
