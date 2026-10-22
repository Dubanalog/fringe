import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReportDoc } from '@fringe/budget-engine';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeText, fileText, odsText, wordText, xlsxText } from './file-text';
import { reportWorkbook } from './xlsx';

const doc: ReportDoc = {
  title: 'Night Shift',
  budgetName: 'night-shift',
  created: '2026-10-15T12:00:00.000Z',
  precision: 'cents',
  sections: [
    {
      id: 'topsheet',
      title: 'Topsheet',
      blocks: [
        {
          kind: 'table',
          columns: [
            { label: 'Acct', kind: 'text' },
            { label: 'Category', kind: 'text' },
            { label: 'Total', kind: 'money' },
          ],
          rows: [{ style: 'normal', cells: ['1100', 'Story & Rights', { value: '2150.5', kind: 'money' }] }],
        },
      ],
    },
  ],
};

let dir = '';
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fringe-file-text-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
const file = async (name: string, data: Uint8Array | string) => {
  const path = join(dir, name);
  await writeFile(path, data);
  return path;
};

describe('xlsxText', () => {
  it('gives each sheet’s cells, row by row', () => {
    const text = xlsxText(unzipSync(reportWorkbook(doc)));
    expect(text).toContain('=== Sheet: Topsheet ===');
    expect(text).toMatch(/\tAcct\tCategory\tTotal\n/);
    expect(text).toMatch(/\t1100\tStory & Rights\t2150\.5/);
  });

  it('reads shared strings, inline strings and gaps between cells', () => {
    const files = {
      'xl/workbook.xml': strToU8(
        '<workbook><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>',
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>',
      ),
      'xl/sharedStrings.xml': strToU8(
        '<sst><si><t>Cast</t></si><si><r><t>Dir</t></r><r><t>ector</t></r></si></sst>',
      ),
      'xl/worksheets/sheet1.xml': strToU8(
        '<worksheet><sheetData><row r="3"><c r="A3" t="s"><v>0</v></c><c r="C3"><v>1200</v></c></row>' +
          '<row r="4"><c r="A4" t="s"><v>1</v></c><c r="B4" t="inlineStr"><is><t>a &amp; b</t></is></c></row></sheetData></worksheet>',
      ),
    };
    expect(xlsxText(files).split('\n').slice(2)).toEqual([
      '=== Sheet: Budget ===',
      '3\tCast\t\t1200',
      '4\tDirector\ta & b',
    ]);
  });
});

describe('odsText', () => {
  it('reads values and repeated cells', () => {
    const content =
      '<office:document-content><table:table table:name="Top"><table:table-row><table:table-cell office:value-type="string"><text:p>2000</text:p></table:table-cell>' +
      '<table:table-cell table:number-columns-repeated="2"/><table:table-cell office:value-type="float" office:value="75000"><text:p>75,000</text:p></table:table-cell>' +
      '</table:table-row></table:table></office:document-content>';
    expect(odsText(content).split('\n').slice(2)).toEqual(['=== Sheet: Top ===', '1\t2000\t\t\t75000']);
  });
});

describe('wordText', () => {
  it('keeps paragraphs and table cells apart', () => {
    const xml =
      '<w:document><w:body><w:p><w:r><w:t>Deal memo</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Rate</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:p><w:r><w:t>$5,000</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>';
    expect(wordText(xml)).toBe('Deal memo\nRate\n\t$5,000');
  });
});

describe('decodeText', () => {
  it('reads UTF-8, UTF-16 and Windows-1252, and refuses binary', () => {
    expect(decodeText(strToU8('Café,100'))).toBe('Café,100');
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x41, 0, 0x42, 0]))).toBe('AB');
    expect(decodeText(new Uint8Array([0x43, 0x61, 0x66, 0xe9]))).toBe('Café');
    expect(decodeText(new Uint8Array([1, 2, 0, 4, 5]))).toBeNull();
  });
});

describe('fileText', () => {
  it('reads text whatever its extension', async () => {
    expect(await fileText(await file('budget.export', '1100,Story,2150'))).toEqual({
      kind: 'text',
      text: '1100,Story,2150',
      how: 'text',
    });
  });

  it('reads an Excel workbook as a spreadsheet', async () => {
    const got = await fileText(await file('budget.xlsx', reportWorkbook(doc)));
    expect(got).toMatchObject({ kind: 'text', how: 'spreadsheet' });
  });

  it('leaves PDFs to the AI and explains what it can’t read', async () => {
    expect(await fileText(await file('top.pdf', '%PDF-1.7'))).toEqual({ kind: 'media' });
    const old = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    expect(await fileText(await file('old.xls', old))).toMatchObject({ kind: 'unreadable' });
    expect(await fileText(await file('data.bin', new Uint8Array([0, 1, 2, 3])))).toMatchObject({
      kind: 'unreadable',
    });
    expect(await fileText(await file('other.zip', zipSync({ 'a.png': new Uint8Array([1]) })))).toMatchObject({
      kind: 'unreadable',
    });
  });
});
