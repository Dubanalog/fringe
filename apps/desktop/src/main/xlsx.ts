import {
  type ReportBlock,
  type ReportColumn,
  type ReportDoc,
  type RowStyle,
  assumptionsText,
  cellText,
  cellValue,
  printedDate,
} from '@fringe/budget-engine';
import { strToU8, zipSync } from 'fflate';

/**
 * Reports as an Excel workbook (.xlsx), one sheet per report. Written by hand: an .xlsx is a ZIP of
 * a few XML files, and reports only need text, numbers, bold rows and number formats. Money and
 * other figures are real numbers, so they add up in Excel.
 */

const xml = (s: string) =>
  s
    // Characters XML 1.0 doesn't allow.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Column letters: 0 → A, 26 → AA. */
function column(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const FONTS = [
  '<font><sz val="10"/><name val="Calibri"/></font>',
  '<font><b/><sz val="10"/><name val="Calibri"/></font>',
  '<font><b/><sz val="14"/><name val="Calibri"/></font>',
  '<font><i/><sz val="10"/><color rgb="FF555555"/><name val="Calibri"/></font>',
];
const Font = { Normal: 0, Bold: 1, Title: 2, Muted: 3 } as const;
type Font = (typeof Font)[keyof typeof Font];
const BORDERS = [
  '<border><left/><right/><top/><bottom/><diagonal/></border>',
  '<border><left/><right/><top/><bottom style="thin"/><diagonal/></border>',
  '<border><left/><right/><top style="thin"/><bottom/><diagonal/></border>',
  '<border><left/><right/><top style="thin"/><bottom style="double"/><diagonal/></border>',
];
const Border = { None: 0, Below: 1, Above: 2, Grand: 3 } as const;
type Border = (typeof Border)[keyof typeof Border];

/** Cell styles, made as they're needed. */
class Styles {
  private readonly xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  private readonly index = new Map<string, number>([['0/0/0', 0]]);

  constructor(private readonly moneyFormat: number) {}

  get(font: Font, format: number, border: Border, wrap = false): number {
    const key = `${font}/${format}/${border}${wrap ? '/w' : ''}`;
    let i = this.index.get(key);
    if (i === undefined) {
      i = this.xfs.length;
      this.xfs.push(
        `<xf numFmtId="${format}" fontId="${font}" fillId="0" borderId="${border}" xfId="0"${format ? ' applyNumberFormat="1"' : ''}${font ? ' applyFont="1"' : ''}${border ? ' applyBorder="1"' : ''}${wrap ? ' applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' : '/>'}`,
      );
      this.index.set(key, i);
    }
    return i;
  }

  format(kind: ReportColumn['kind']): number {
    return { text: 0, money: this.moneyFormat, number: 164, percent: 165, rate: 166 }[kind];
  }

  xml(): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.####"/><numFmt numFmtId="165" formatCode="0.00##&quot;%&quot;"/><numFmt numFmtId="166" formatCode="#,##0.00##"/></numFmts><fonts count="${FONTS.length}">${FONTS.join('')}</fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="${BORDERS.length}">${BORDERS.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  }
}

const ROW_FONT: Record<RowStyle, Font> = {
  normal: Font.Normal,
  heading: Font.Bold,
  subtotal: Font.Bold,
  total: Font.Bold,
  grand: Font.Bold,
  note: Font.Muted,
};
const ROW_BORDER: Record<RowStyle, Border> = {
  normal: Border.None,
  heading: Border.None,
  subtotal: Border.Above,
  total: Border.Above,
  grand: Border.Grand,
  note: Border.None,
};

interface Sheet {
  name: string;
  xml: string;
}

function textCell(ref: string, text: string, style: number): string {
  return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
}

function sheetXml(doc: ReportDoc, title: string, blocks: readonly ReportBlock[], styles: Styles): string {
  const rows: string[] = [];
  const widths: number[] = [];
  const widen = (col: number, text: string) => {
    widths[col] = Math.min(60, Math.max(widths[col] ?? 8, text.length + 2));
  };
  let freezeAt = 0;
  const add = (cells: string[]) => {
    const r = rows.length + 1;
    rows.push(`<row r="${r}">${cells.join('')}</row>`);
  };
  add([textCell('A1', `${doc.title} — ${title}`, styles.get(Font.Title, 0, Border.None))]);
  add([textCell('A2', printedDate(doc.created), styles.get(Font.Muted, 0, Border.None))]);
  add([]);
  let wide = false;
  for (const block of blocks) {
    if (block.kind === 'html') {
      wide = true;
      for (const line of assumptionsText(block.html).split('\n')) {
        add([textCell(`A${rows.length + 1}`, line, styles.get(Font.Normal, 0, Border.None, true))]);
      }
      continue;
    }
    const header = rows.length + 1;
    if (freezeAt === 0) freezeAt = header;
    add(
      block.columns.map((col, i) => {
        widen(i, col.label);
        return textCell(`${column(i)}${header}`, col.label, styles.get(Font.Bold, 0, Border.Below));
      }),
    );
    for (const row of block.rows) {
      const r = rows.length + 1;
      const font = ROW_FONT[row.style];
      const border = ROW_BORDER[row.style];
      add(
        row.cells.flatMap((cell, i) => {
          const col = block.columns[i]!;
          const ref = `${column(i)}${r}`;
          const v = cellValue(cell, col);
          if (!v) return border ? [`<c r="${ref}" s="${styles.get(font, 0, border)}"/>`] : [];
          const shown = cellText(cell, col, doc.precision);
          widen(i, shown);
          if (v.kind !== 'text' && /^-?\d+(\.\d+)?$/.test(v.value)) {
            return [
              `<c r="${ref}" s="${styles.get(font, styles.format(v.kind), border)}"><v>${v.value}</v></c>`,
            ];
          }
          return [textCell(ref, shown, styles.get(font, 0, border))];
        }),
      );
    }
    add([]);
  }
  const cols = wide
    ? '<cols><col min="1" max="1" width="100" customWidth="1"/></cols>'
    : widths.length > 0
      ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
      : '';
  const pane = freezeAt
    ? `<pane ySplit="${freezeAt}" topLeftCell="A${freezeAt + 1}" activePane="bottomLeft" state="frozen"/>`
    : '';
  // In Excel's header codes &L and &R start the left and right parts, and && is an &.
  const code = (s: string) => s.replace(/&/g, '&&');
  const head = xml(`&L${code(doc.title)}&R${code(title)}`);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>${cols}<sheetData>${rows.join('')}</sheetData><pageMargins left="0.5" right="0.5" top="0.75" bottom="0.6" header="0.3" footer="0.3"/><pageSetup orientation="portrait" fitToWidth="1" fitToHeight="0"/><headerFooter><oddHeader>${head}</oddHeader><oddFooter>&amp;CPage &amp;P of &amp;N</oddFooter></headerFooter></worksheet>`;
}

/** A sheet name Excel accepts: at most 31 characters, none of []:*?/\, and not repeated. */
function sheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet';
  let out = base;
  for (let n = 2; used.has(out.toLowerCase()); n++) out = `${base.slice(0, 27)} (${n})`;
  used.add(out.toLowerCase());
  return out;
}

export function reportWorkbook(doc: ReportDoc): Uint8Array {
  const styles = new Styles(doc.precision === 'dollars' ? 3 : 4);
  const used = new Set<string>();
  const sheets: Sheet[] = doc.sections.map((s) => ({
    name: sheetName(s.title, used),
    xml: sheetXml(doc, s.title, s.blocks, styles),
  }));
  if (sheets.length === 0) sheets.push({ name: 'Reports', xml: sheetXml(doc, 'Reports', [], styles) });
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
      .map(
        (_s, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join('')}</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map(
        (_s, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join(
        '',
      )}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
  };
  sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(s.xml)));
  // Styles last: the sheets above added the styles they use.
  files['xl/styles.xml'] = strToU8(styles.xml());
  return zipSync(files, { level: 6 });
}
