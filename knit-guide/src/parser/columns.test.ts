/** Reading order on a two-column page: wrapped full-width lines stay one paragraph; table rows and headings do not. */
import { describe, expect, it } from 'vitest';
import { readingOrder } from './extract';

interface It { str: string; x: number; y: number; w: number; h: number; font: string }
/** one text run per line (as pdf.js reports a line set in one font) */
const run = (text: string, x: number, y: number): It[] => [{ str: text, x, y, w: text.length * 5, h: 10, font: 'body' }];
const words = (text: string, x: number, y: number): It[] => {
  const out: It[] = [];
  let cx = x;
  for (const w of text.split(' ')) {
    out.push({ str: w, x: cx, y, w: w.length * 5, h: 10, font: 'body' });
    cx += w.length * 5 + 3;
  }
  return out;
};

function page() {
  const items: It[] = [];
  // a normal two-column body: 8 rows in each column
  for (let i = 0; i < 8; i++) {
    items.push(...words(`left column line number ${i} with some text`, 60, 700 - i * 12));
    items.push(...words(`right column line number ${i} with some text`, 330, 700 - i * 12));
  }
  // full-width footnotes under the columns: the first line crosses the gutter, its wrapped end does not
  items.push(...run('If working 3/4 length sleeves subtract 30 (30, 30, 50, 50, 50, 60, 80, 100, 110, 110, 110, 120, 130, 140, 150, 160,', 60, 560));
  items.push(...run('150, 150, 150, 150) yards.', 60, 548));
  items.push(...run('If working short sleeves subtract 40 (50, 60, 80, 100, 120, 150, 190, 210, 220, 230, 230, 240, 250, 260, 270, 280,', 60, 520));
  items.push(...run('250, 270, 280, 300) yards.', 60, 508));
  return readingOrder(items as never, 612, 1, 'body');
}

describe('two-column reading order', () => {
  const lines = page();
  const at = (s: string) => lines.find((l) => l.text.startsWith(s))!;

  it('keeps the left column before the right column', () => {
    const left = lines.findIndex((l) => l.text.startsWith('left column line number 7'));
    const right = lines.findIndex((l) => l.text.startsWith('right column line number 0'));
    expect(left).toBeGreaterThan(-1);
    expect(right).toBeGreaterThan(left);
  });

  it('a wrapped full-width line continues the paragraph (no break), a new sentence starts one', () => {
    expect(at('150, 150, 150, 150) yards.').breakBefore).toBeUndefined();
    expect(at('If working short sleeves').breakBefore).toBe(true);
    expect(at('250, 270, 280, 300) yards.').breakBefore).toBeUndefined();
    expect(at('If working 3/4').breakBefore).toBe(true);
  });
});
