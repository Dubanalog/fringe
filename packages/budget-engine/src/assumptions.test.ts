import { describe, expect, it } from 'vitest';
import { assumptionsText, cleanAssumptions } from './assumptions';

describe('assumptions', () => {
  it('keeps formatting and drops anything unsafe', () => {
    expect(
      cleanAssumptions(
        '<h2 onclick="x()">Shoot</h2><p>22 <b>weeks</b><script>alert(1)</script><img src=x onerror=y></p>' +
          '<ul><li style="color: red; position: fixed">Union <a href="javascript:x">crew</a></li></ul>',
      ),
    ).toBe('<h2>Shoot</h2><p>22 <b>weeks</b></p><ul><li style="color: red">Union crew</li></ul>');
  });

  it('closes tags, escapes stray text and turns old <font> into styles', () => {
    expect(cleanAssumptions('<p>a < b & c<strong>bold')).toBe('<p>a &lt; b &amp; c<strong>bold</strong></p>');
    expect(cleanAssumptions('<font color="#ff0000" size="5">Big</font>')).toBe(
      '<span style="color: #ff0000; font-size: x-large">Big</span>',
    );
    expect(cleanAssumptions('<span style="background: url(x); font-size: 14pt">t</span>')).toBe(
      '<span style="font-size: 14pt">t</span>',
    );
  });

  it('turns plain text into paragraphs and empty formatting into nothing', () => {
    expect(cleanAssumptions('22 shoot weeks\n\nNon-union crew')).toBe(
      '<p>22 shoot weeks</p><p>Non-union crew</p>',
    );
    expect(cleanAssumptions('<p><br></p>')).toBe('');
  });

  it('reads as plain text', () => {
    expect(
      assumptionsText(
        '<h1>Shoot</h1><ul><li>22 weeks</li><li>LA &amp; NY</li></ul><ol><li>a</li><li>b</li></ol>',
      ),
    ).toBe('Shoot\n• 22 weeks\n• LA & NY\n1. a\n2. b');
  });
});
