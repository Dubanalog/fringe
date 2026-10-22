import { type ReportDoc, reportHtml } from '@fringe/budget-engine';

/** Letter paper and the PDF's margins, in CSS pixels (96 to the inch). */
const INCH = 96;
const MARGIN = { top: 0.6 * INCH, side: 0.5 * INCH };

const SHEET_CSS = `
  html.paged, html.paged body { background: transparent; }
  html.paged body { padding: 16px 0; }
  .sheet {
    margin: 0 auto 20px;
    padding: ${MARGIN.top}px ${MARGIN.side}px;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18), 0 4px 14px rgba(0, 0, 0, 0.12);
    overflow: hidden;
  }
  .sheet > section:first-child > h2:first-child, .sheet > :first-child { margin-top: 0; }
`;

const outerHeight = (el: Element) => {
  const style = el.ownerDocument.defaultView!.getComputedStyle(el);
  return el.getBoundingClientRect().height + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
};

/**
 * Lays the report out as the PDF's pages: each section starts a page, and a page takes rows
 * until it's full, repeating the table's column headings on the next. Close to the PDF, not
 * exact: the printer breaks pages itself.
 */
function paginate(doc: Document, landscape: boolean) {
  const width = (landscape ? 11 : 8.5) * INCH;
  const height = (landscape ? 8.5 : 11) * INCH;
  const room = height - 2 * MARGIN.top;
  const body = doc.body;
  const style = doc.createElement('style');
  style.textContent = SHEET_CSS;
  doc.head.append(style);
  // Measure at the page's text width.
  body.style.padding = '0';
  body.style.width = `${width - 2 * MARGIN.side}px`;

  const items = [...body.children].filter((el) => el.tagName !== 'SCRIPT');
  const sheets: HTMLElement[] = [];
  let sheet: HTMLElement;
  let section: HTMLElement | null = null;
  let used = 0;
  const newSheet = () => {
    sheet = doc.createElement('div');
    sheet.className = 'sheet';
    sheet.style.width = `${width}px`;
    sheet.style.height = `${height}px`;
    sheets.push(sheet);
    section = null;
    used = 0;
  };
  // Where the next piece goes: the current section on this sheet, or the sheet itself.
  const into = (inSection: Element | null) => {
    if (!inSection) return sheet;
    if (!section) {
      section = doc.createElement('section');
      section.className = inSection.className;
      sheet.append(section);
    }
    return section;
  };
  const place = (el: Element, h: number, inSection: Element | null) => {
    if (used > 0 && used + h > room) newSheet();
    into(inSection).append(el);
    used += h;
  };
  const placeTable = (table: HTMLTableElement, inSection: Element) => {
    const head = table.tHead;
    const headH = head ? outerHeight(head) : 0;
    const style = doc.defaultView!.getComputedStyle(table);
    const extra = parseFloat(style.marginBottom);
    let part: HTMLTableElement | null = null;
    let tbody: HTMLTableSectionElement;
    const start = () => {
      part = table.cloneNode(false) as HTMLTableElement;
      if (head) part.append(head.cloneNode(true));
      tbody = doc.createElement('tbody');
      part.append(tbody);
      into(inSection).append(part);
      used += headH + extra;
    };
    for (const tr of [...table.tBodies].flatMap((b) => [...b.rows])) {
      const h = tr.getBoundingClientRect().height;
      if (!part || (used + h > room && tbody!.rows.length > 0)) {
        if (part && used + h > room) newSheet();
        else if (!part && used > 0 && used + headH + h + extra > room) newSheet();
        start();
      }
      tbody!.append(tr);
      used += h;
    }
  };

  // Text blocks (assumptions) flow paragraph by paragraph, in a box like the one they came from.
  const placeFlow = (box: Element, inSection: Element) => {
    let part: Element | null = null;
    for (const p of [...box.children]) {
      const h = outerHeight(p);
      if (used > 0 && used + h > room) {
        newSheet();
        part = null;
      }
      if (!part) {
        part = box.cloneNode(false) as Element;
        into(inSection).append(part);
      }
      part.append(p);
      used += h;
    }
  };

  newSheet();
  let sections = 0;
  for (const item of items) {
    if (item.tagName !== 'SECTION') {
      place(item, outerHeight(item), null);
      continue;
    }
    // Every section after the first starts a page, as in the PDF.
    if (sections++ > 0) newSheet();
    section = null;
    for (const child of [...item.children]) {
      if (child.tagName === 'TABLE') placeTable(child as HTMLTableElement, item);
      else if (child.classList.contains('assumptions')) placeFlow(child, item);
      else place(child, outerHeight(child), item);
    }
  }
  body.replaceChildren(...sheets);
  body.style.width = '';
  body.style.padding = '';
  doc.documentElement.classList.add('paged');
}

/** The report as it will print, page by page. */
export function ReportPreview({ doc, landscape }: { doc: ReportDoc; landscape: boolean }) {
  return (
    <iframe
      title="Report preview"
      className="report-pages"
      // No scripts run inside; the app lays out the pages from outside.
      sandbox="allow-same-origin"
      srcDoc={reportHtml(doc)}
      onLoad={(e) => {
        const inner = e.currentTarget.contentDocument;
        if (inner?.body) paginate(inner, landscape);
      }}
      key={landscape ? 'landscape' : 'portrait'}
    />
  );
}
