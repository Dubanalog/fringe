/**
 * A budget's assumptions: formatted notes (headings, bold, bullets, text size, colour) kept in
 * budget settings and printed with the reports. They're stored as a small, safe subset of HTML so
 * the app's editor, the printout and an AI can all read and write them. Everything that comes in,
 * from the editor, a .fringe file or an AI, goes through `cleanAssumptions` first.
 */

/** Tags assumptions may use. Anything else is dropped; its text is kept. */
const TAGS = new Set([
  'p',
  'div',
  'h1',
  'h2',
  'h3',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'ul',
  'ol',
  'li',
  'br',
  'span',
  'blockquote',
]);
/** Tags dropped with everything in them. */
const DROPPED = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'template',
  'svg',
  'math',
  'head',
  'title',
]);
const VOID = new Set(['br']);

const COLOR =
  /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+%?\s*)?\)|[a-z]{3,20})$/i;
/** Style properties assumptions may use, and the values each allows. */
const STYLES: Record<string, RegExp> = {
  color: COLOR,
  'background-color': COLOR,
  'font-size':
    /^(\d{1,3}(\.\d+)?(px|pt|em|rem|%)|xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger)$/i,
  'font-weight': /^(bold|bolder|normal|[1-9]00)$/i,
  'font-style': /^(italic|normal)$/i,
  'text-decoration': /^(underline|line-through|none)$/i,
  'text-decoration-line': /^(underline|line-through|none)$/i,
  'text-align': /^(left|right|center|justify|start|end)$/i,
};
/** Old-style <font size=1..7>, as some editors still write it. */
const FONT_SIZES = ['x-small', 'small', 'medium', 'large', 'x-large', 'xx-large', 'xxx-large'];

function attribute(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(attrs);
  return m ? decode(m[1] ?? m[2] ?? m[3] ?? '') : null;
}

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|quot|amp|apos|lt|gt);/gi, (all, e: string) => {
    const lower = e.toLowerCase();
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return { quot: '"', amp: '&', apos: "'", lt: '<', gt: '>' }[lower] ?? all;
  });
}

function cleanStyle(style: string): string {
  const kept: string[] = [];
  for (const decl of style.split(';')) {
    const at = decl.indexOf(':');
    if (at < 0) continue;
    const prop = decl.slice(0, at).trim().toLowerCase();
    const value = decl.slice(at + 1).trim();
    if (STYLES[prop]?.test(value)) kept.push(`${prop}: ${value}`);
  }
  return kept.join('; ');
}

/** Text as it may appear between tags: `&` that isn't an entity, `<` and `>` escaped. */
function cleanText(s: string): string {
  return s
    .replace(/&(?!(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]{1,31});)/gi, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Assumptions as safe HTML: only the tags and styles above, every tag closed, no scripts, links,
 * images or event handlers. Plain text (no tags) becomes paragraphs, one per line.
 */
export function cleanAssumptions(html: string): string {
  if (!/<[a-z!/]/i.test(html)) {
    return html
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line)
      .map((line) => `<p>${cleanText(line)}</p>`)
      .join('');
  }
  const out: string[] = [];
  const open: string[] = [];
  let skip: string | null = null;
  const token = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-z][a-z0-9]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|<|[^<]+/gi;
  for (const m of html.matchAll(token)) {
    const [all, close, rawName, attrs = ''] = m;
    if (all.startsWith('<!--')) continue;
    if (!rawName) {
      if (!skip) out.push(cleanText(all));
      continue;
    }
    const name = rawName.toLowerCase();
    if (skip) {
      if (close && name === skip) skip = null;
      continue;
    }
    if (DROPPED.has(name)) {
      if (!close && !/\/\s*$/.test(attrs)) skip = name;
      continue;
    }
    const tag = name === 'font' ? 'span' : name;
    if (!TAGS.has(tag)) continue;
    if (close) {
      const at = open.lastIndexOf(tag);
      if (at < 0) continue;
      while (open.length > at) out.push(`</${open.pop()!}>`);
      continue;
    }
    let style = cleanStyle(attribute(attrs, 'style') ?? '');
    if (name === 'font') {
      const color = attribute(attrs, 'color');
      const size = FONT_SIZES[Number(attribute(attrs, 'size')) - 1];
      const extra = [color && COLOR.test(color) ? `color: ${color}` : '', size ? `font-size: ${size}` : '']
        .filter(Boolean)
        .join('; ');
      style = [style, extra].filter(Boolean).join('; ');
    }
    out.push(`<${tag}${style ? ` style="${style.replace(/"/g, '&quot;')}"` : ''}>`);
    if (!VOID.has(tag)) open.push(tag);
  }
  while (open.length > 0) out.push(`</${open.pop()!}>`);
  const cleaned = out.join('');
  return assumptionsText(cleaned) ? cleaned : '';
}

/** Assumptions as plain text, for a spreadsheet or a search: one line per paragraph, bullets as •. */
export function assumptionsText(html: string): string {
  // Each open list: its next number, or 0 for bullets.
  const lists: number[] = [];
  const tags = /<(\/?)(ol|ul|li|br|p|div|h[1-6]|blockquote)\b[^>]*>|<[^>]*>/gi;
  const text = html.replace(tags, (_all, close: string, tag?: string) => {
    const name = tag?.toLowerCase();
    if (!name) return '';
    if (name === 'ol' || name === 'ul') {
      if (close) lists.pop();
      else lists.push(name === 'ol' ? 1 : 0);
      return '\n';
    }
    if (name === 'li' && !close) {
      const at = lists.at(-1) ?? 0;
      if (at > 0) lists[lists.length - 1] = at + 1;
      return `\n${'  '.repeat(Math.max(0, lists.length - 1))}${at > 0 ? `${at}.` : '•'} `;
    }
    return name === 'br' || close ? '\n' : '';
  });
  return decode(text)
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.trim())
    .join('\n');
}

/** A short description of what assumptions may contain, for the AI. */
export const ASSUMPTIONS_FORMAT =
  'HTML using only: <h1> <h2> <h3> headings, <p> paragraphs, <strong> bold, <em> italic, <u> underline, <s> strikethrough, <ul>/<ol> with <li> bullets and numbered lists, <br>, <blockquote>, and <span style="…"> for colour and size. Allowed styles (on any of these tags): color, background-color (highlight), font-size (e.g. 14pt, 18px, large), font-weight, font-style, text-decoration, text-align. Anything else is removed.';
