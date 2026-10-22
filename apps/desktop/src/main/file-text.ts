import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';

/**
 * The text of a file the user gave the AI, whatever made it: text files as they are, Excel and
 * OpenDocument spreadsheets as their cells (sheet by sheet, row by row), Word and OpenDocument
 * documents as their words. Other files are read as text when they are text, whatever their
 * extension (many programs export text under their own one). PDFs and pictures aren't text: the
 * AI reads those itself.
 */

export type FileText =
  | { kind: 'text'; text: string; how: string }
  /** A PDF or picture: for the AI's own reading. */
  | { kind: 'media' }
  /** Nothing readable here: `why` says what to ask the user for. */
  | { kind: 'unreadable'; why: string };

const MEDIA = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp']);
const MAX_FILE = 64 * 1024 * 1024;

const ASK_FOR =
  'Ask the user to export it from the program that made it as PDF, Excel (.xlsx), CSV or XML, and add that instead.';

export async function fileText(path: string): Promise<FileText> {
  const ext = extname(path).toLowerCase();
  if (MEDIA.has(ext)) return { kind: 'media' };
  const size = (await stat(path)).size;
  if (size > MAX_FILE)
    return { kind: 'unreadable', why: `The file is too big to read (over 64 MB). ${ASK_FOR}` };
  const data = new Uint8Array(await readFile(path));
  if (isZip(data)) {
    const zipped = zippedText(data);
    if (zipped) return zipped;
    return { kind: 'unreadable', why: `It's a kind of zipped file Fringe can't read. ${ASK_FOR}` };
  }
  if (ext === '.xls' || isOldOffice(data))
    return {
      kind: 'unreadable',
      why: 'It\'s an old-style Excel or Word file (from before 2007), which Fringe can\'t read. Ask the user to open it and "Save As" Excel Workbook (.xlsx) or CSV, and add that instead.',
    };
  const text = decodeText(data);
  if (text === null) return { kind: 'unreadable', why: `It isn't text, a spreadsheet or a PDF. ${ASK_FOR}` };
  return { kind: 'text', text, how: 'text' };
}

const isZip = (d: Uint8Array) => d.length > 4 && d[0] === 0x50 && d[1] === 0x4b && d[2] === 3 && d[3] === 4;
/** The old binary Office format (.xls, .doc). */
const isOldOffice = (d: Uint8Array) =>
  d.length > 8 && [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((b, i) => d[i] === b);

/** The file as text, or null when it's binary. UTF-8, UTF-16 (with its BOM) or Windows-1252. */
export function decodeText(d: Uint8Array): string | null {
  if (d[0] === 0xff && d[1] === 0xfe) return new TextDecoder('utf-16le').decode(d.subarray(2));
  if (d[0] === 0xfe && d[1] === 0xff) return new TextDecoder('utf-16be').decode(d.subarray(2));
  const sample = d.subarray(0, 65536);
  if (sample.includes(0)) return null;
  // Control characters other than tab, line breaks and form feed mean binary.
  let control = 0;
  for (const b of sample) if (b < 32 && b !== 9 && b !== 10 && b !== 13 && b !== 12) control++;
  if (control > sample.length / 100) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(d);
  } catch {
    return new TextDecoder('windows-1252').decode(d);
  }
}

function zippedText(data: Uint8Array): FileText | null {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, {
      filter: (f) =>
        f.name === 'mimetype' ||
        f.name === 'content.xml' ||
        f.name === 'word/document.xml' ||
        f.name.startsWith('xl/'),
    });
  } catch {
    return null;
  }
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : null);
  if (files['xl/workbook.xml']) return { kind: 'text', text: xlsxText(files), how: 'spreadsheet' };
  const doc = text('word/document.xml');
  if (doc) return { kind: 'text', text: wordText(doc), how: 'document' };
  const content = text('content.xml');
  const mime = text('mimetype') ?? '';
  if (content && mime.includes('spreadsheet'))
    return { kind: 'text', text: odsText(content), how: 'spreadsheet' };
  if (content) return { kind: 'text', text: odtText(content), how: 'document' };
  return null;
}

// ---- XML, just enough of it ----

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const unescapeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === '#'
      ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
      : (ENTITIES[e] ?? m),
  );

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? unescapeXml(m[1]!) : null;
};
/** The text inside, tags taken out. */
const inner = (xml: string) => unescapeXml(xml.replace(/<[^>]*>/g, ''));

// ---- Spreadsheets ----

/** Cells as lines: the sheet's name, then each row with something in it, its number first, tab-separated. */
function sheetLines(name: string, rows: Map<number, Map<number, string>>): string[] {
  const out = [`=== Sheet: ${name} ===`];
  for (const [r, cells] of [...rows].sort((a, b) => a[0] - b[0])) {
    const last = Math.max(...cells.keys());
    const values: string[] = [];
    for (let c = 0; c <= last; c++) values.push((cells.get(c) ?? '').replace(/[\t\r\n]+/g, ' '));
    out.push(`${r}\t${values.join('\t')}`);
  }
  return out;
}

/** "AB12" → column 27 (from 0), row 12. */
function cellRef(ref: string): { col: number; row: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]!) col = col * 26 + ch.charCodeAt(0) - 64;
  return { col: col - 1, row: Number(m[2]) };
}

export function xlsxText(files: Record<string, Uint8Array>): string {
  const read = (name: string) => (files[name] ? strFromU8(files[name]) : '');
  const shared = [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    // Rich text has runs; phonetic hints (rPh) aren't part of the text.
    inner(m[1]!.replace(/<rPh[\s\S]*?<\/rPh>/g, '')),
  );
  const targets = new Map(
    [...read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
      attr(m[0], 'Id'),
      attr(m[0], 'Target'),
    ]),
  );
  const out: string[] = [
    'Spreadsheet cells, sheet by sheet: each line is a row number, then its cells from column A, separated by tabs. Dates are day numbers counted from 1900, as Excel keeps them.',
  ];
  for (const m of read('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name') ?? 'Sheet';
    const target = targets.get(attr(m[0], 'r:id')) ?? '';
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const xml = read(path);
    const rows = new Map<number, Map<number, string>>();
    for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const at = cellRef(attr(c[0], 'r') ?? '');
      if (!at || !c[2]) continue;
      const type = attr(`<c${c[1]}>`, 't');
      const v = /<v>([\s\S]*?)<\/v>/.exec(c[2])?.[1];
      let value: string;
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = inner(/<is>([\s\S]*?)<\/is>/.exec(c[2])?.[1] ?? '');
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else value = v === undefined ? '' : unescapeXml(v);
      if (value === '') continue;
      if (!rows.has(at.row)) rows.set(at.row, new Map());
      rows.get(at.row)!.set(at.col, value);
    }
    out.push('', ...sheetLines(name, rows));
  }
  return out.join('\n');
}

export function odsText(content: string): string {
  const out: string[] = [
    'Spreadsheet cells, sheet by sheet: each line is a row number, then its cells from column A, separated by tabs.',
  ];
  for (const t of content.matchAll(/<table:table\b([^>]*)>([\s\S]*?)<\/table:table>/g)) {
    const rows = new Map<number, Map<number, string>>();
    let r = 0;
    for (const row of t[2]!.matchAll(/<table:table-row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-row>)/g)) {
      const repeatRows = Number(attr(row[0], 'table:number-rows-repeated') ?? 1);
      r += 1;
      const cells = new Map<number, string>();
      let c = 0;
      for (const cell of (row[2] ?? '').matchAll(
        /<table:(?:covered-)?table-cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g,
      )) {
        const repeat = Math.min(Number(attr(cell[0], 'table:number-columns-repeated') ?? 1), 1000);
        const open = `<x${cell[1]}>`;
        const value =
          attr(open, 'office:value') ??
          attr(open, 'office:date-value') ??
          [...(cell[2] ?? '').matchAll(/<text:p\b[^>]*>([\s\S]*?)<\/text:p>/g)]
            .map((p) => inner(p[1]!.replace(/<text:s\b[^>]*\/>/g, ' ').replace(/<text:tab\/>/g, ' ')))
            .join(' ');
        if (value !== '') for (let i = 0; i < repeat; i++) cells.set(c + i, value);
        c += repeat;
      }
      if (cells.size > 0) rows.set(r, cells);
      r += repeatRows - 1;
    }
    out.push('', ...sheetLines(attr(`<x${t[1]}>`, 'table:name') ?? 'Sheet', rows));
  }
  return out.join('\n');
}

// ---- Documents ----

/** A Word document's words: paragraphs on their own lines, table cells separated by tabs. */
export function wordText(xml: string): string {
  return tidy(
    inner(
      xml
        .replace(/<w:tab\/>/g, '\t')
        .replace(/<w:br\b[^>]*\/>/g, '\n')
        .replace(/<\/w:p>/g, '\n')
        .replace(/<\/w:tc>/g, '\t'),
    ),
  );
}

function odtText(xml: string): string {
  return tidy(
    inner(
      xml
        .replace(/<text:tab\/>/g, '\t')
        .replace(/<text:s\b[^>]*\/>/g, ' ')
        .replace(/<text:line-break\/>/g, '\n')
        .replace(/<\/text:(p|h)>/g, '\n')
        .replace(/<\/table:table-cell>/g, '\t'),
    ),
  );
}

const tidy = (s: string) =>
  s
    .replace(/\t+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
