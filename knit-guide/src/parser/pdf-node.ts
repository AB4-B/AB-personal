// Node helper used by tests and the dev CLI
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'node:fs';
import { extractPdf } from './extract';
import { parsePattern } from './parse';

export async function parsePdfFile(path: string) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)) }).promise;
  const pages = await extractPdf(doc as never, pdfjs.OPS as never);
  return parsePattern(pages, { fileId: 'test', fileName: path.split('/').pop()! });
}
