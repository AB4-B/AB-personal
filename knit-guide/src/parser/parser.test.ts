import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findSizeGroups, resolveText } from '../model/size';
import { detectSuggestions } from './detect';
import type { Pattern } from '../model/types';

const FIXTURE = 'fixtures/raglan-lace-cardigan.pdf';
const hasFixture = existsSync(FIXTURE);

describe('size groups', () => {
  const sizes = ['S', 'M', 'L', 'XL', '2X', '3X'];
  it('resolves [] and () groups per size and keeps the original', () => {
    const t = 'Provisional cast on 50 [50, 54, 54, 54, 58] sts. Follow for 44 (50, 52, 58, 64, 66) rows.';
    expect(resolveText(t, sizes, 0)).toBe('Provisional cast on 50 sts. Follow for 44 rows.');
    expect(resolveText(t, sizes, 5)).toBe('Provisional cast on 58 sts. Follow for 66 rows.');
    expect(findSizeGroups(t, 6)).toHaveLength(2);
  });
  it('does not resolve a group with the wrong number of values', () => {
    const t = 'repeat 2 (2, 2, 3, 3, 3, 4) more times';
    expect(findSizeGroups(t, 6)[0].matchesSizes).toBe(false);
    expect(resolveText(t, sizes, 2)).toBe(t);
  });
  it('ignores ordinary brackets', () => {
    expect(findSizeGroups('k1, p1 (right front), (10 cm x 10 cm)', 6)).toHaveLength(0);
  });
});

describe('suggestions', () => {
  it('detects stitch counters for cast on / pick up', () => {
    const s = detectSuggestions('Provisional cast on 50 [50, 54, 54, 54, 58] sts.', 6);
    expect(s[0]).toMatchObject({ kind: 'stitch', values: ['50', '50', '54', '54', '54', '58'], perSize: true });
    expect(detectSuggestions('pick up 164 stitches along the edge', 6)[0]).toMatchObject({ kind: 'stitch', values: ['164'] });
    expect(detectSuggestions('Increase to 120 sts', 6)[0].kind).toBe('stitch');
  });
  it('detects rows, rounds and repeats; flags a bad size list', () => {
    expect(detectSuggestions('Work 8 rounds of 1x1 ribbing.', 6)[0]).toMatchObject({ kind: 'rounds', values: ['8'] });
    expect(detectSuggestions('every 4th row 11 (11, 13, 13, 12, 14) times', 6)[0]).toMatchObject({ kind: 'times' });
    expect(detectSuggestions('repeat 2 (2, 2, 3, 3, 3, 4) more times', 6)[0].review).toMatch(/7 values/);
    expect(detectSuggestions('Work 8-12 rows in 1x1 ribbing.', 6)[0].review).toMatch(/range/);
  });
});

describe.skipIf(!hasFixture)('parse the supplied test pattern (generic parser, no hard-coding)', async () => {
  const { parsePdfFile } = await import('./pdf-node');
  let p: Pattern;
  it('parses', async () => {
    p = await parsePdfFile(FIXTURE);
    expect(p.pageCount).toBe(7);
  });
  it('metadata', () => {
    expect(p.title).toBe('Top-Down Raglan Summer Lace Cardigan');
    expect(p.designer).toBe('ABC Knitting Patterns');
    expect(p.sizes).toEqual(['S', 'M', 'L', 'XL', '2X', '3X']);
    expect(p.measurements[0].inches).toEqual(['36', '40', '44', '48', '52', '56']);
    expect(p.measurements[0].cm).toEqual(['90', '100', '110', '120', '130', '140']);
    expect(p.gauge).toMatchObject({ stitches: 16, rows: 21, overInches: 4 });
    expect(p.yarn.weight).toBe('DK');
    expect(p.needles).toMatch(/US 6/);
    expect(p.techniques).toContain('Provisional cast on');
    expect(p.abbreviations.map((a) => a.abbr)).toEqual(expect.arrayContaining(['ssk', 'yo', 'k2tog', 'M1', 'pu&k']));
  });
  it('sections follow the designer headings', () => {
    expect(p.sections.map((s) => s.title)).toEqual([
      'Pattern notes', 'Selvedge Stitches', 'Cardigan', 'Divide for sleeves', 'Sleeve', 'Button Band',
    ]);
  });
  it('lace repeat is 4 rows', () => {
    const lace = p.stitchPatterns.find((s) => s.unit === 'row' && s.rows.length > 1)!;
    expect(lace.length).toBe(4);
    expect(lace.rows[0].text).toBe('k2, yo, ssk');
  });
  it('charts get captions and the schematic is kept as an image', () => {
    expect(p.images.filter((i) => i.kind === 'chart').map((i) => i.title)).toEqual([
      'Left Front Chart', 'Sleeve Chart', 'Back Chart', 'Right Front Chart',
    ]);
    expect(p.images.some((i) => i.kind === 'diagram')).toBe(true);
  });
  it('every instruction keeps source page and verbatim text', () => {
    for (const i of p.instructions.filter((x) => !x.generated)) {
      expect(i.source.page).toBeGreaterThan(0);
      expect(i.text.length).toBeGreaterThan(0);
    }
  });
  it('flags the 7-value repeat list for review', () => {
    const bad = p.instructions.find((i) => i.text.includes('2 (2, 2, 3, 3, 3, 4)'))!;
    expect(bad.review?.[0]).toMatch(/7 numbers/);
  });
  it('builds a simultaneous tracker: raglan spans + V-neck interval + lace, flagged NEEDS REVIEW', () => {
    const t = p.trackers.find((x) => x.unit === 'row')!;
    expect(t.spans.map((s) => s.name)).toEqual(['Back Chart', 'Sleeve Chart', 'Left Front Chart and Right Front Chart']);
    expect(t.intervals[0]).toMatchObject({ every: 4, times: ['11', '11', '13', '13', '12', '14'], firstAssumed: true });
    expect(t.lace).toBeDefined();
    expect(t.endRows).toEqual(['44', '50', '52', '58', '64', '66']);
    expect(t.review.length).toBeGreaterThan(0);
    // the designer's own sentence is kept verbatim
    expect(t.intervals[0].excerpt).toContain('AT THE SAME TIME');
  });
  it('detects a round tracker for the sleeves', () => {
    expect(p.trackers.find((x) => x.unit === 'round')).toBeDefined();
  });
  it('suggests a stitch counter on the cast on', () => {
    const cast = p.instructions.find((i) => /^Provisional cast on/.test(i.text))!;
    expect(detectSuggestions(cast.text, p.sizes.length)[0].values[0]).toBe('50');
  });
});
