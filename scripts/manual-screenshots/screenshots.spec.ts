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
  /** A close-up of the parts of the page that `selectors` match, with a margin around them. */
  const shotAround = async (name: string, ...selectors: string[]) => {
    await page.waitForTimeout(500);
    const boxes = [];
    for (const sel of selectors) {
      const box = await page.locator(sel).first().boundingBox();
      if (box) boxes.push(box);
    }
    const m = 12;
    const left = Math.max(0, Math.min(...boxes.map((b) => b.x)) - m);
    const top = Math.max(0, Math.min(...boxes.map((b) => b.y)) - m);
    const right = Math.max(...boxes.map((b) => b.x + b.width)) + m;
    const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + m;
    await page.screenshot({
      path: join(OUT, `${name}.png`),
      clip: { x: left, y: top, width: right - left, height: bottom - top },
    });
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

  await go(page, 'Versions');
  await page.getByRole('checkbox', { name: 'Show branches not picked' }).check();
  // Ticking it scrolls the page down to the box; the picture starts at the top.
  await page.evaluate(() =>
    document.querySelectorAll('*').forEach((el) => {
      if (el.scrollTop) el.scrollTop = 0;
    }),
  );
  await shot('history');
  // Hover a version for its details, then click a Latest point for what you can do there.
  await page.getByRole('button', { name: 'Fringe Life, v2.0' }).hover();
  await shotAround('versions-tip', '.branch-tree', '.tree-tip');
  await page.mouse.move(0, 0);
  await page.getByRole('button', { name: /^Fringe Life, Latest/ }).click();
  await shotAround('versions-menu', '.branch-tree', '.context-menu');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Fringe Life, v2.0' }).click();
  await page.getByText(/compare with v1.1/i).click();
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
