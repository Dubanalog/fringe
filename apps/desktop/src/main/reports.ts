import { randomUUID } from 'node:crypto';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { type ReportDoc, cellText, cleanAssumptions, printedDate, reportHtml } from '@fringe/budget-engine';
import { BrowserWindow, type SaveDialogOptions, app, dialog, shell } from 'electron';
import type { ReportFormat, SaveReportResult } from '../shared/ipc';
import { isOpenProject, writeAtomic } from './projects';
import { reportWorkbook } from './xlsx';

/** Saving reports as PDF, Excel or JSON. The renderer builds the reports (engine's buildReports). */

const FORMATS: Record<ReportFormat, { name: string; extension: string }> = {
  pdf: { name: 'PDF', extension: 'pdf' },
  xlsx: { name: 'Excel workbook', extension: 'xlsx' },
  json: { name: 'JSON', extension: 'json' },
};

export const isReportFormat = (v: unknown): v is ReportFormat =>
  typeof v === 'string' && Object.hasOwn(FORMATS, v);

/** A report from the renderer, checked enough to print safely. Assumptions are cleaned again here. */
export function checkedReport(v: unknown): ReportDoc {
  const doc = v as ReportDoc;
  if (
    !doc ||
    typeof doc !== 'object' ||
    typeof doc.title !== 'string' ||
    typeof doc.created !== 'string' ||
    !Array.isArray(doc.sections)
  ) {
    throw new Error('That isn’t a report.');
  }
  return {
    ...doc,
    precision: doc.precision === 'dollars' ? 'dollars' : 'cents',
    sections: doc.sections.map((s) => ({
      ...s,
      blocks: s.blocks.map((b) => (b.kind === 'html' ? { kind: 'html', html: cleanAssumptions(b.html) } : b)),
    })),
  };
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The reports as a PDF: the page printed by Chromium, with the title on every page and page numbers. */
export async function reportPdf(doc: ReportDoc, landscape: boolean): Promise<Buffer> {
  const file = join(app.getPath('temp'), `fringe-report-${randomUUID()}.html`);
  await writeFile(file, reportHtml(doc, { titleBlock: false }), 'utf8');
  const win = new BrowserWindow({
    show: false,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    await win.loadFile(file);
    const font = 'font-family: Segoe UI, system-ui, Helvetica, Arial, sans-serif; color: #555;';
    return await win.webContents.printToPDF({
      pageSize: 'Letter',
      landscape,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `<div style="${font} font-size: 8pt; width: 100%; margin: 0 0.5in; display: flex; justify-content: space-between;"><span style="font-weight: 600; color: #111;">${escape(doc.title)}</span><span>${escape(printedDate(doc.created))}</span></div>`,
      footerTemplate: `<div style="${font} font-size: 8pt; width: 100%; text-align: center;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
      margins: { top: 0.75, bottom: 0.6, left: 0.5, right: 0.5 },
    });
  } finally {
    win.destroy();
    await rm(file, { force: true });
  }
}

/** The reports as JSON: each table's rows keyed by column, with figures as exact decimal strings. */
export function reportJson(doc: ReportDoc): string {
  return JSON.stringify(
    {
      format: 'fringe-reports',
      version: 1,
      title: doc.title,
      budget: doc.budgetName,
      created: doc.created,
      reports: doc.sections.map((s) => ({
        id: s.id,
        title: s.title,
        blocks: s.blocks.map((b) =>
          b.kind === 'html'
            ? { kind: 'html', html: b.html }
            : {
                kind: 'table',
                columns: b.columns,
                rows: b.rows.map((r) => ({
                  style: r.style,
                  cells: Object.fromEntries(
                    b.columns.map((col, i) => {
                      const cell = r.cells[i] ?? null;
                      return [col.label, typeof cell === 'object' && cell !== null ? cell.value : cell];
                    }),
                  ),
                  text: r.cells.map((c, i) => cellText(c, b.columns[i]!, doc.precision)),
                })),
              },
        ),
      })),
    },
    null,
    2,
  );
}

/** Asks where to save, then writes the reports in that format. Null when the user cancels. */
export async function saveReport(
  win: BrowserWindow | null,
  format: ReportFormat,
  doc: ReportDoc,
  name: string,
  landscape: boolean,
): Promise<SaveReportResult | null> {
  const { name: kind, extension } = FORMATS[format];
  const options: SaveDialogOptions = {
    title: `Save reports as ${kind}`,
    defaultPath: join(app.getPath('documents'), `${safeFileName(name, 'Reports')}.${extension}`),
    filters: [{ name: kind, extensions: [extension] }],
  };
  const picked = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
  if (picked.canceled || !picked.filePath) return null;
  let file = picked.filePath;
  if (extname(file).toLowerCase() !== `.${extension}`) file += `.${extension}`;
  try {
    const data =
      format === 'pdf'
        ? await reportPdf(doc, landscape)
        : format === 'xlsx'
          ? reportWorkbook(doc)
          : Buffer.from(reportJson(doc), 'utf8');
    await writeAtomic(file, data);
    return { ok: true, file };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Couldn’t save the reports.' };
  }
}

/** Asks where to save the budget's CSV, then writes it: UTF-8 with a BOM, so Excel reads accents right. */
export async function saveBudgetCsv(
  win: BrowserWindow | null,
  csv: string,
  name: string,
): Promise<SaveReportResult | null> {
  const options: SaveDialogOptions = {
    title: 'Export budget as CSV',
    defaultPath: join(app.getPath('documents'), `${safeFileName(name, 'Budget')}.csv`),
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  };
  const picked = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
  if (picked.canceled || !picked.filePath) return null;
  let file = picked.filePath;
  if (extname(file).toLowerCase() !== '.csv') file += '.csv';
  try {
    await writeAtomic(file, Buffer.from(`\uFEFF${csv}`, 'utf8'));
    return { ok: true, file };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Couldn’t save the CSV.' };
  }
}

/**
 * A name made safe as a file name on Windows, macOS and Linux alike: no characters any of them
 * refuse, no trailing dots or spaces, and not too long.
 */
export function safeFileName(name: string, fallback: string): string {
  const clean = name
    .replace(/[<>:"/\\|?*]/g, ' ')
    .split('')
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join('')
    .replace(/[. ]+$/, '')
    .trim()
    .slice(0, 120);
  // Names Windows keeps for devices, whatever the extension.
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(clean)) return `${clean} budget`;
  return clean || fallback;
}

/** A file name for a version's PDF, e.g. "Pilot v1.0.pdf". */
const versionPdfName = (name: string) => `${safeFileName(name.replace(/\.pdf$/i, ''), 'Budget')}.pdf`;

/** Saves a version's reports as a PDF in the project's versions folder; returns the file name. */
export async function saveVersionPdf(
  folder: unknown,
  name: string,
  doc: ReportDoc,
  landscape: boolean,
): Promise<string> {
  if (!isOpenProject(folder)) throw new Error('That project is not open.');
  const file = versionPdfName(name);
  await mkdir(join(folder, 'versions'), { recursive: true });
  await writeAtomic(join(folder, 'versions', file), await reportPdf(doc, landscape));
  return file;
}

/** Shows a version's PDF in the system file manager; false when it's no longer there. */
export async function revealVersionPdf(folder: unknown, name: unknown): Promise<boolean> {
  if (!isOpenProject(folder) || typeof name !== 'string') return false;
  const file = join(folder, 'versions', versionPdfName(name));
  try {
    await access(file);
  } catch {
    return false;
  }
  shell.showItemInFolder(file);
  return true;
}
