import { describe, expect, it } from 'vitest';
import { isDocument } from './knowledge';

describe('budget files', () => {
  it('opens documents, never programs or shortcuts', () => {
    for (const f of ['rates.pdf', 'Deal Memo.DOCX', 'knowledge/sheet.xlsx', 'notes.md'])
      expect(isDocument(f)).toBe(true);
    for (const f of [
      'setup.exe',
      'rates.pdf.exe',
      'run.bat',
      'x.cmd',
      'x.ps1',
      'link.lnk',
      'x.js',
      'x.hta',
      'x.xlsm',
      'x.svg',
      'noext',
    ])
      expect(isDocument(f)).toBe(false);
  });
});
