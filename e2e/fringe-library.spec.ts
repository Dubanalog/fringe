import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { answerFileDialogs, buildBudget, expect, launch, test } from './app';

test('shares fringe rates: save from a budget, export, import elsewhere, add to a new budget', async ({
  app,
  page,
  home,
}) => {
  await buildBudget(page);
  await page.getByRole('button', { name: 'Budget Settings' }).click();
  await page.getByRole('tab', { name: 'Fringes' }).click();
  await page.getByRole('button', { name: 'Save These to Library' }).click();
  await expect(page.getByText('Saved to the library: 1 added.')).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Settings', exact: true })
    .click();
  await expect(page.getByRole('textbox', { name: 'Library fringe name' })).toHaveValue('Payroll');
  await expect(page.getByRole('textbox', { name: 'Source of Payroll' })).toHaveValue('From Test Show');
  const file = join(home, 'Fringe Rates.json');
  await answerFileDialogs(app, file);
  await page.getByRole('button', { name: 'Export Rates…' }).click();
  await expect.poll(() => existsSync(file)).toBe(true);

  const other = await launch(join(home, 'elsewhere'));
  try {
    const p = other.page;
    await answerFileDialogs(other.app, file);
    await p.getByPlaceholder('Name it after the show').fill('Next Show');
    await p.getByRole('button', { name: 'Create' }).click();
    await p
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: 'Settings', exact: true })
      .click();
    await p.getByRole('button', { name: 'Import Rates…' }).click();
    await expect(p.getByText('Imported: 1 added.')).toBeVisible();

    await p.getByRole('button', { name: 'Budget Settings' }).click();
    await p.getByRole('tab', { name: 'Fringes' }).click();
    await p.getByRole('button', { name: 'Add from Library…' }).click();
    await p.getByRole('checkbox', { name: 'Add Payroll' }).check();
    await p.getByRole('button', { name: 'Add 1 to Budget' }).click();
    await expect(p.getByRole('textbox', { name: 'Rate of Payroll' })).toHaveValue('10');
  } finally {
    await other.app.close();
  }
});
