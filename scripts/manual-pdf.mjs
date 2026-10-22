// Builds docs/manual.md into a PDF with Electron's own print engine, so it needs nothing the app
// doesn't already have. Run from the repo root:  npx electron scripts/manual-pdf.mjs [out.pdf]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(
  process.argv.find((a) => a.endsWith('.pdf')) ?? `${root}/apps/desktop/release/Fringe-Manual.pdf`,
);
const md = readFileSync(`${root}/docs/manual.md`, 'utf8');
const body = micromark(md, { extensions: [gfm()], htmlExtensions: [gfmHtml()] });
const font = (w) =>
  pathToFileURL(
    `${root}/node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-${w}-normal.woff2`,
  );
const mark = readFileSync(`${root}/docs/brand/fringe-icon.svg`, 'utf8');

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Fringe User Manual</title><style>
@font-face { font-family: Jakarta; font-weight: 400; src: url(${font(400)}); }
@font-face { font-family: Jakarta; font-weight: 600; src: url(${font(600)}); }
@font-face { font-family: Jakarta; font-weight: 700; src: url(${font(700)}); }
body { font: 10.5pt/1.55 Jakarta, 'Segoe UI', sans-serif; color: #1a1a1a; margin: 0; }
.cover { height: 9.2in; display: flex; flex-direction: column; justify-content: center; page-break-after: always; }
.cover svg { width: 1.1in; height: 1.1in; }
.cover h1 { display: block; font-size: 34pt; margin: 0.3in 0 0.05in; border: 0; }
.cover p { color: #666; font-size: 13pt; margin: 0; }
h1 { display: none; }
h2 { font-size: 17pt; margin: 26pt 0 8pt; padding-top: 10pt; border-top: 2px solid #F2B33D; page-break-after: avoid; }
h3 { font-size: 12pt; margin: 14pt 0 4pt; page-break-after: avoid; }
hr { display: none; }
p, li { orphans: 3; widows: 3; }
code { font: 9pt Consolas, Menlo, monospace; background: #f3f1ec; padding: 1px 4px; border-radius: 3px; }
table { border-collapse: collapse; width: 100%; margin: 8pt 0; page-break-inside: avoid; font-size: 9.5pt; }
th, td { text-align: left; padding: 4pt 8pt; border-bottom: 1px solid #ddd; vertical-align: top; }
th { background: #f6f4ef; font-weight: 600; }
</style></head><body>
<section class="cover">${mark}<h1>Fringe</h1><p>User Manual</p></section>
${body}
</body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  // From a file, so the page may load the fonts from node_modules.
  const page = `${tmpdir()}/fringe-manual.html`;
  writeFileSync(page, html);
  await win.loadFile(page);
  const pdf = await win.webContents.printToPDF({
    pageSize: 'Letter',
    margins: { top: 0.75, bottom: 0.75, left: 0.8, right: 0.8 },
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate:
      '<div style="font: 8pt sans-serif; color: #888; width: 100%; text-align: center;"><span class="pageNumber"></span></div>',
  });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, pdf);
  console.log(`Wrote ${out}`);
  app.quit();
});
