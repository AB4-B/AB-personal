import { describe, expect, it } from 'vitest';
import { explain, tokenizeAbbreviations } from './explain';

describe('explain', () => {
  it('k2, yo, ssk -> 4 plain steps', () => {
    const e = explain('Row 1: k2, yo, ssk', []);
    expect(e.steps).toEqual([
      'Row 1:',
      'Knit 2 stitches.',
      'Bring the yarn forward and make a yarn over.',
      'Slip the next two stitches knitwise, one at a time.',
      'Insert the left needle into the front of those two slipped stitches and knit them together.',
    ]);
    expect(e.terms.map((t) => t.key)).toEqual(expect.arrayContaining(['k', 'yo', 'ssk']));
  });
  it('handles labelled stitches and k2 tog spelling', () => {
    const e = explain('Set-up row (WS): k1, p1 (right front), pm, p22 sts (back)', []);
    expect(e.steps).toContain('Purl 1 stitch (right front).');
    expect(e.steps).toContain('Purl 22 stitches (back).');
    expect(explain('k2 tog, yo', []).steps[0]).toMatch(/two stitches together/);
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
