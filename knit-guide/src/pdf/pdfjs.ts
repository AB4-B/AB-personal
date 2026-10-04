// Single place that configures pdf.js (legacy build: works on older iOS Safari).
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };
export type { PDFDocumentProxy } from 'pdfjs-dist';

export async function loadPdf(data: ArrayBuffer) {
  // pdf.js transfers the buffer to its worker, so always hand it a copy
  return pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
}
