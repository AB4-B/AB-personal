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
    const sorted = [...s.items].sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: (typeof sorted)[] = [];
    for (const it of sorted) {
      const row = rows.find((r) => Math.abs(r[0].y - it.y) < Math.max(2, it.h * 0.3));
      if (row) row.push(it);
      else rows.push([it]);
    }
    const lines: RawLine[] = rows.map((r) => {
      r.sort((a, b) => a.x - b.x);
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
        page: s.page,
        y: r[0].y,
        x: r[0].x,
        size: Math.max(...r.map((i) => i.h)),
        text: text.replace(/\s+/g, ' ').trim(),
        emphasis: r.every((i) => i.font !== bodyFont),
      };
    });
    lines.sort((a, b) => b.y - a.y);
    pages.push({ page: s.page, width: s.width, height: s.height, lines, images: s.images });
    onProgress?.(doc.numPages + s.page, doc.numPages * 2);
  }
  return pages;
}
