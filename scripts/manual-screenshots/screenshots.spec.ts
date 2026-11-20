/**
 * Takes the screenshots in docs/images/ for the manual, from the "Fringe Life" sample budget
 * (fringe-life.ts). Build the app first (`npx electron-vite build` in apps/desktop), then run
 * `npx playwright test --config scripts/manual-screenshots/playwright.config.ts`.
 */
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type Page } from '@playwright/test';
import { answerFileDialogs, launch } from '../../e2e/app';
import { buildHistory, writeProject } from './fringe-life';

const OUT = fileURLToPath(new URL('../../docs/images/', import.meta.url));

test('manual screenshots', async () => {
  mkdirSync(OUT, { recursive: true });
  const home = mkdtempSync(join(tmpdir(), 'fringe-shots-'));
  const folder = writeProject(join(home, 'Documents', 'Fringe Budgets'), buildHistory());
  const { app, page } = await launch(home);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1360, 840));
  await answerFileDialogs(app, folder);
  await page.waitForTimeout(800);

  const shot = async (name: string) => {
    await page.waitForTimeout(700);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: join(OUT, `${name}.png`) });
  };
  const go = (p: Page, name: string) =>
    p.getByRole('navigation', { name: 'Main' }).getByRole('button', { name, exact: true }).click();

  await page.keyboard.press('Control+O');
  await page.getByRole('button', { name: 'Open 3000 CAMERA' }).waitFor();
  await shot('topsheet');

  await page.getByRole('button', { name: 'Open 3000 CAMERA' }).click();
  await page.getByRole('button', { name: 'Open 3001 CAMERA CREW' }).click();
  await page
    .getByRole('row', { name: /1st AC/ })
    .getByRole('cell')
    .nth(2)
    .click();
  await shot('detail');

  await go(page, 'Budget Settings');
  await page.getByRole('tab', { name: 'Fringes' }).click();
  await shot('fringes');
  await page.getByRole('tab', { name: 'Percentages' }).click();
  await shot('percentages');

  await go(page, 'Reports');
  await shot('reports');

  await go(page, 'Crew List');
  await shot('crew-list');

  await go(page, 'History');
  await shot('history');
  await page.getByRole('button', { name: 'Compare with v1.1' }).click();
  for (const name of ['Topsheet', 'Account Summary', 'Detail'])
    await page.getByRole('checkbox', { name, exact: true }).uncheck();
  await shot('compare');

  await go(page, 'Knowledge');
  await shot('knowledge');

  await go(page, 'Settings');
  await page
    .getByRole('heading', { name: 'Fringe Rates' })
    .evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await shot('settings-rates-knowledge');

  await app.close();
});
