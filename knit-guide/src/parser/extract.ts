/**
 * Stage 1: raw extraction from a PDF using pdf.js. No knitting knowledge here.
 * Works in the browser and in Node (tests) - the caller passes the pdf.js module.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface RawLine {
  page: number;
  /** PDF user-space y (origin bottom-left) */
  y: number;
  x: number;
  size: number;
  text: string;
  /** every item on the line uses a non-body font (usually bold) */
  emphasis: boolean;
  /** start a new paragraph here regardless of spacing */
  breakBefore?: boolean;
}

export interface RawImage {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** pixel size of the embedded bitmap, if known */
  pxW?: number;
  pxH?: number;
}

export interface RawPage {
  page: number;
  width: number;
  height: number;
  lines: RawLine[];
  images: RawImage[];
}

interface OpsLike {
  save: number;
  restore: number;
  transform: number;
  paintImageXObject: number;
  paintInlineImageXObject: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
}

type M = [number, number, number, number, number, number];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];

export async function extractPdf(
  doc: PDFDocumentProxy,
  OPS: OpsLike,
  onProgress?: (done: number, total: number) => void,
): Promise<RawPage[]> {
  const pages: RawPage[] = [];
  const fontChars = new Map<string, number>();
  const staged: {
    page: number;
    width: number;
    height: number;
    items: { str: string; x: number; y: number; w: number; h: number; font: string }[];
    images: RawImage[];
  }[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const [x0, y0, x1, y1] = page.view;
    const tc = await page.getTextContent();
    const items = [];
    for (const it of tc.items as any[]) {
      if (!('str' in it) || !it.str.trim()) continue;
      fontChars.set(it.fontName, (fontChars.get(it.fontName) ?? 0) + it.str.length);
      items.push({
        str: it.str as string,
        x: it.transform[4] as number,
        y: it.transform[5] as number,
        w: it.width as number,
        h: it.height as number,
        font: it.fontName as string,
      });
    }

    const images: RawImage[] = [];
    const ops = await page.getOperatorList();
    let ctm: M = [1, 0, 0, 1, 0, 0];
    const stack: M[] = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      const args = ops.argsArray[i];
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
      else if (fn === OPS.transform) ctm = mul(args as M, ctm);
      else if (fn === OPS.paintFormXObjectBegin) {
        stack.push(ctm);
        if (args?.[0]) ctm = mul(args[0] as M, ctm);
      } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
      else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
        const w = Math.abs(ctm[0]);
        const h = Math.abs(ctm[3]);
        images.push({
          page: p,
          x: Math.min(ctm[4], ctm[4] + ctm[0]),
          y: Math.min(ctm[5], ctm[5] + ctm[3]),
          w,
          h,
        });
      }
    }
    staged.push({ page: p, width: x1 - x0, height: y1 - y0, items, images });
    onProgress?.(p, doc.numPages * 2);
  }

  const bodyFont = [...fontChars.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  for (const s of staged) {
    const lines = readingOrder(s.items, s.width, s.page, bodyFont);
    pages.push({ page: s.page, width: s.width, height: s.height, lines, images: s.images });
    onProgress?.(doc.numPages + s.page, doc.numPages * 2);
  }
  return pages;
}

/* ------------------------------------------------------------ reading order */

interface Item { str: string; x: number; y: number; w: number; h: number; font: string }

function groupRows(items: Item[]): Item[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Item[][] = [];
  for (const it of sorted) {
    const row = rows.find((r) => Math.abs(r[0].y - it.y) < Math.max(2, it.h * 0.3));
    if (row) row.push(it);
    else rows.push([it]);
  }
  for (const r of rows) r.sort((a, b) => a.x - b.x);
  return rows;
}

function rowToLine(r: Item[], page: number, bodyFont: string | undefined): RawLine {
  let text = '';
  let prevEnd = 0;
  r.forEach((it, i) => {
    if (i > 0) {
      const gap = it.x - prevEnd;
      const needsSpace = gap > it.h * 0.18 && !text.endsWith(' ') && !it.str.startsWith(' ');
      if (needsSpace) text += ' ';
    }
    text += it.str;
    prevEnd = it.x + it.w;
  });
  return {
    page,
    y: r[0].y,
    x: r[0].x,
    size: Math.max(...r.map((i) => i.h)),
    text: text.replace(/\s+/g, ' ').trim(),
    emphasis: r.every((i) => i.font !== bodyFont),
  };
}

/**
 * Two-column pages (Tin Can Knits and many others) would otherwise be read straight across both
 * columns. A gutter is found only when many rows have long text on both sides of the same x;
 * rows that straddle it or look like a table (many short cells) stay full width and separate zones.
 * Within a zone the left column is read top to bottom, then the right column.
 */
export function readingOrder(items: Item[], pageWidth: number, page: number, bodyFont: string | undefined): RawLine[] {
  // lone letters on a diagram ("a", "b", "c" callouts) are not text; table rows keep theirs ("S", "M")
  const rows = groupRows(items)
    .map((r) => {
      if (r.length >= 6) return r;
      const keep = (it: Item, k: number) =>
        !/^[A-Za-z]$/.test(it.str.trim()) ||
        (k > 0 && it.x - (r[k - 1].x + r[k - 1].w) < 40) ||
        (r[k + 1] !== undefined && r[k + 1].x - (it.x + it.w) < 15);
      return r.filter(keep);
    })
    .filter((r) => r.length > 0);
  const plain = () => rows.map((r) => rowToLine(r, page, bodyFont)).sort((a, b) => b.y - a.y);
  if (rows.length < 10) return plain();

  const isTable = (r: Item[]) => {
    if (r.length < 6) return false;
    const lens = r.map((i) => i.str.trim().length).sort((a, b) => a - b);
    if (lens[Math.floor(lens.length / 2)] > 7) return false;
    // table cells are separated by real gaps; a line of prose full of numbers ("30, 30, 50, 50, ...") is not a table row
    const wide = r.slice(1).filter((it, k) => it.x - (r[k].x + r[k].w) > 8).length;
    return wide >= Math.max(3, Math.floor(r.length * 0.4));
  };
  // a right-hand column shows up as many lines starting at the same x in the middle of the page,
  // with nothing from the left side running into it
  const prose = rows.filter((r) => !isTable(r));
  let best = { n: 0, at: 0 };
  for (let c = Math.ceil(pageWidth * 0.38); c <= pageWidth * 0.66; c++) {
    const n = prose.filter((r) => r.some((it) => it.x >= c && it.x <= c + 12 && it.str.trim().length >= 3)).length;
    if (n > best.n) best = { n, at: c };
  }
  ((globalThis as any).__dbg ??= []).push(['cand', page, rows.length, prose.length, best]);
  if (best.n < 5) return plain();
  // the column's real left edge: the leftmost start inside the winning window
  const g = Math.min(...prose.flatMap((r) => r.filter((it) => it.x >= best.at - 12 && it.x <= best.at + 12 && it.str.trim().length >= 3 && it.x > pageWidth * 0.36).map((it) => it.x)), best.at);
  const crossing = prose.reduce((n, r) => n + r.filter((i) => i.str.trim().length >= 4 && i.x < g - 4 && i.x + i.w > g - 1).length, 0);
  (globalThis as any).__dbg.push(['cols', page, g, prose.reduce((n, r) => n + r.filter((i) => i.str.trim().length >= 4 && i.x < g - 4 && i.x + i.w > g - 1).length, 0)]);
  const leftRows = prose.filter((r) => r.some((i) => i.x < g - 4)).length;
  if (crossing > Math.max(2, prose.length * 0.04) || leftRows < 6 || (best.n < 7 && crossing > 0)) return plain();

  const straddles = (r: Item[]) => r.some((i) => i.x < g - 4 && i.x + i.w > g - 1);

  const out: RawLine[] = [];
  let zone: Item[][] = [];
  const flush = () => {
    if (!zone.length) return;
    const side = (pick: (i: Item) => boolean, firstBreak: boolean) => {
      const ls: RawLine[] = [];
      for (const r of zone) {
        const part = r.filter(pick);
        if (part.length) ls.push(rowToLine(part, page, bodyFont));
      }
      // a column made only of short scattered labels is a diagram, not text
      const short = ls.filter((l) => l.text.split(/\s+/).length <= 4).length;
      const xs = new Set(ls.map((l) => Math.round(l.x / 12)));
      if (ls.length >= 6 && short / ls.length >= 0.7 && xs.size >= 5) return [];
      if (ls.length && firstBreak) ls[0] = { ...ls[0], breakBefore: true };
      return ls;
    };
    out.push(...side((i) => i.x < g - 4, true), ...side((i) => i.x >= g - 4, true));
    zone = [];
  };
  // Rows are grouped into: table rows, full-width rows (they cross the gutter) and column zones. A one-line zone
  // directly under a full-width row, starting at the same left edge, is the wrapped end of that paragraph (for
  // example "150, 150, 150) yards." under "If working 3/4 sleeves subtract 30 (30, 30, ..."), not a column.
  type Seg = { kind: 'wide' | 'table' | 'zone'; rows: Item[][] };
  const segs: Seg[] = [];
  for (const r of rows) {
    const kind: Seg['kind'] = isTable(r) ? 'table' : straddles(r) ? 'wide' : 'zone';
    const last = segs[segs.length - 1];
    if (kind === 'zone' && last?.kind === 'zone') last.rows.push(r);
    else segs.push({ kind, rows: [r] });
  }
  const minX = (r: Item[]) => Math.min(...r.map((i) => i.x));
  const textOf = (r: Item[]) => r.map((i) => i.str).join(' ').trim();
  for (let i = 1; i < segs.length; i++) {
    const s = segs[i];
    const prev = segs[i - 1];
    if (s.kind !== 'zone' || prev.kind !== 'wide') continue;
    const above = prev.rows[prev.rows.length - 1];
    const first = s.rows[0];
    // the first line of the zone is the wrapped end of the full-width line above it: same left edge, one line down,
    // nothing in the right column, and the line above stopped mid-sentence
    if (Math.abs(minX(first) - minX(above)) < 4 && first.every((it) => it.x < g - 4) && above[0].y - first[0].y < 20 && !/[.!?:]$/.test(textOf(above))) {
      segs.splice(i, 1, { kind: 'wide', rows: [first] }, ...(s.rows.length > 1 ? [{ kind: 'zone' as const, rows: s.rows.slice(1) }] : []));
    }
  }
  let prevWide = false;
  let prevText = '';
  for (const seg of segs) {
    if (seg.kind === 'zone') {
      zone = seg.rows;
      flush();
      prevWide = false;
    } else {
      for (const r of seg.rows) {
        const line = rowToLine(r, page, bodyFont);
        // a line that ends a sentence starts a new paragraph; a line that stops mid-sentence is wrapped onto the next
        const wrapped = seg.kind === 'wide' && prevWide && !/[.!?:]$/.test(prevText);
        out.push({ ...line, breakBefore: wrapped ? undefined : true });
        prevWide = seg.kind === 'wide';
        prevText = line.text;
      }
    }
  }
  return dropDiagramLabels(out);
}

/** Short isolated labels printed on diagrams ("sleeve sts on hold", "garter panel") are not instructions. */
function dropDiagramLabels(lines: RawLine[]): RawLine[] {
  const body = lines.map((l) => l.size).sort((a, b) => a - b)[Math.floor(lines.length / 2)] ?? 10;
  return lines.filter((l, i) => {
    const words = l.text.split(/\s+/).length;
    if (/^[A-Za-z]$/.test(l.text)) return false; // a lone letter is a diagram callout
    if (words > 3 || /[.:;]$/.test(l.text) || l.emphasis || l.size > body * 1.15) return true;
    if (!/^[a-z0-9’'/ -]+$/.test(l.text) || /\d/.test(l.text) && !/^[a-z ]+$/.test(l.text)) return true;
    const prev = lines[i - 1];
    const next = lines[i + 1];
    const far = (a?: RawLine) => !a || Math.abs(a.y - l.y) > body * 2.6 || a.x < l.x - 40 || a.x > l.x + 40;
    return !(far(prev) && far(next));
  });
}
