import type { ReportDoc } from '@fringe/budget-engine';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { reportWorkbook } from './xlsx';

const doc: ReportDoc = {
  title: 'Night Shift & Co',
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
          rows: [
            { style: 'normal', cells: ['1100', 'Story <Rights>', { value: '2150', kind: 'money' }] },
            { style: 'grand', cells: [null, 'Grand Total', { value: '2150', kind: 'money' }] },
          ],
        },
      ],
    },
    {
      id: 'assumptions',
      title: 'Assumptions',
      blocks: [{ kind: 'html', html: '<ul><li>40 days</li></ul>' }],
    },
  ],
};

describe('reportWorkbook', () => {
  it('writes a sheet per report with numbers as numbers and text escaped', () => {
    const files = unzipSync(reportWorkbook(doc));
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        '[Content_Types].xml',
        'xl/workbook.xml',
        'xl/styles.xml',
        'xl/worksheets/sheet1.xml',
        'xl/worksheets/sheet2.xml',
      ]),
    );
    const workbook = strFromU8(files['xl/workbook.xml']!);
    expect(workbook).toContain('name="Topsheet"');
    expect(workbook).toContain('name="Assumptions"');
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']!);
    expect(sheet).toContain('<v>2150</v>');
    expect(sheet).toContain('Story &lt;Rights&gt;');
    expect(sheet).toContain('Night Shift &amp;');
    expect(strFromU8(files['xl/worksheets/sheet2.xml']!)).toContain('• 40 days');
  });
});
