import { describe, expect, it } from 'vitest';
import { explain, tokenizeAbbreviations } from './explain';

describe('explain', () => {
  it('k2, yo, ssk -> 4 plain steps', () => {
    const e = explain('Row 1: k2, yo, ssk', []);
    expect(e.steps).toEqual([
      'Row 1:',
      'Knit the next 2 stitches normally.',
      'Make 1 yarn over (bring the yarn to the front, then over the right needle).',
      'Slip the next stitch knitwise.',
      'Slip the following stitch knitwise.',
      'Knit those 2 slipped stitches together through the back (ssk).',
    ]);
    expect(e.terms.map((t) => t.key)).toEqual(expect.arrayContaining(['k', 'yo', 'ssk']));
  });
  it('handles labelled stitches and k2 tog spelling', () => {
    const e = explain('Set-up row (WS): k1, p1 (right front), pm, p22 sts (back)', []);
    expect(e.steps).toContain('Purl the next 1 stitch (right front).');
    expect(e.steps).toContain('Purl the next 22 stitches (back).');
    expect(explain('k2 tog, yo', []).steps[0]).toMatch(/2 stitches together/);
  });
  it('does not pretend to translate prose', () => {
    const e = explain('Work the bodice as established to desired length.', []);
    expect(e.steps).toEqual([]);
    expect(e.untranslated.length).toBe(1);
  });
  it('tokenizes tappable abbreviations, pattern list wins', () => {
    const parts = tokenizeAbbreviations('k2, yo, ssk', [{ abbr: 'ssk', definition: 'slip, slip, knit', page: 2 }]);
    const ssk = parts.find((p) => p.type === 'term' && p.text === 'ssk');
    expect(ssk && ssk.type === 'term' && ssk.info.fromPattern).toBe('slip, slip, knit');
  });
});
