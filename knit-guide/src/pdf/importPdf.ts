import { uid } from '../model/helpers';
import type { Pattern } from '../model/types';
import { extractPdf } from '../parser/extract';
import { parsePastedText, parsePattern } from '../parser/parse';
import { loadPdf, pdfjs } from './pdfjs';

export interface ImportResult {
  pattern: Pattern;
  fileBlob: Blob;
  /** cropped chart/diagram images rendered from the original PDF, keyed by PatternImage.id */
  imageBlobs: Record<string, Blob>;
}

const CROP_SCALE = 4;

export async function importPdf(file: File, onProgress?: (msg: string, frac: number) => void): Promise<ImportResult> {
  const buf = await file.arrayBuffer();
  onProgress?.('Reading PDF', 0.05);
  const doc = await loadPdf(buf);
  const pages = await extractPdf(doc as never, pdfjs.OPS as never, (d, t) => onProgress?.('Reading text and images', 0.05 + 0.45 * (d / t)));
  onProgress?.('Interpreting pattern', 0.55);
  const fileId = `pdf-${uid()}`;
  const pattern = parsePattern(pages, { fileId, fileName: file.name });

  // Crop each image out of a render of the original page (original file is never touched).
  const imageBlobs: Record<string, Blob> = {};
  const byPage = new Map<number, typeof pattern.images>();
  for (const im of pattern.images) byPage.set(im.page, [...(byPage.get(im.page) ?? []), im]);
  let done = 0;
  for (const [pageNo, imgs] of byPage) {
    const page = await doc.getPage(pageNo);
    const vp = page.getViewport({ scale: CROP_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    await page.render({ canvas, viewport: vp } as never).promise;
    const pageH = page.view[3] - page.view[1];
    for (const im of imgs) {
      const sx = Math.max(0, Math.floor(im.bbox.x * CROP_SCALE));
      const sy = Math.max(0, Math.floor((pageH - (im.bbox.y + im.bbox.h)) * CROP_SCALE));
      const sw = Math.min(canvas.width - sx, Math.ceil(im.bbox.w * CROP_SCALE));
      const sh = Math.min(canvas.height - sy, Math.ceil(im.bbox.h * CROP_SCALE));
      const out = document.createElement('canvas');
      out.width = sw;
      out.height = sh;
      out.getContext('2d')!.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
      const blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/png'));
      if (blob) {
        const fid = `img-${pattern.id}-${im.id}`;
        im.fileId = fid;
        imageBlobs[fid] = blob;
      }
      done++;
      onProgress?.('Extracting charts', 0.6 + 0.35 * (done / pattern.images.length));
    }
    canvas.width = canvas.height = 0;
    page.cleanup();
  }
  onProgress?.('Done', 1);
  return { pattern, fileBlob: new Blob([buf], { type: 'application/pdf' }), imageBlobs };
}

/** Copy-and-paste import. The pasted text itself is stored as the untouched source. */
export function importText(text: string, title?: string): ImportResult {
  const fileId = `text-${uid()}`;
  const pattern = parsePastedText(text, { title, fileId });
  return { pattern, fileBlob: new Blob([text], { type: 'text/plain;charset=utf-8' }), imageBlobs: {} };
}
