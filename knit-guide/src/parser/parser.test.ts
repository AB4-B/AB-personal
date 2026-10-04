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

const SAND = 'fixtures/drops-no-nonsense-cardigan.pdf';
describe.skipIf(!existsSync(SAND))('second pattern: DROPS "Sand Ripples" printed from Safari (no bold, ALL CAPS headings, dash size lists)', async () => {
  const { parsePdfFile } = await import('./pdf-node');
  const p = await parsePdfFile(SAND);
  it('metadata', () => {
    expect(p.title).toBe('Sand Ripples');
    expect(p.designer).toBe('DROPS Design');
    expect(p.sizes).toEqual(['S', 'M', 'L', 'XL', 'XXL', 'XXXL']);
    expect(p.suggestedSize).toBe('M');
    const bust = p.measurements.find((m) => m.label === 'Bust')!;
    expect(bust.cm).toEqual(['80', '88', '98', '106', '118', '130']);
    expect(bust.inches?.[0]).toBe('31½');
    expect(p.gauge).toMatchObject({ stitches: 23, rows: 30, overInches: 4 });
    expect(p.needles).toMatch(/3\.5 mm \/ US 4/);
  });
  it('splits glued ALL CAPS headings from their text', () => {
    expect(p.sections.map((s) => s.title)).toEqual([
      'GARTER ST (back and forth on needle)', 'PATTERN, M.1', 'BUTTONHOLES', 'DECREASING TIP (applies to neckline)',
      'BODY PIECE', 'BACK PIECE', 'RIGHT FRONT PIECE', 'LEFT FRONT PIECE', 'SLEEVE', 'ASSEMBLY',
    ]);
  });
  it('page furniture and website outro are not instructions', () => {
    const all = p.instructions.map((i) => i.text).join('\n');
    expect(all).not.toMatch(/garnstudio\.com|Page \d of|Have you finished|tutorial videos/);
  });
  it('resolves dash lists per size and keeps the original', () => {
    const cast = p.instructions.find((i) => /^Cast on 208/.test(i.text))!;
    expect(cast.text).toContain('208- 228 -248-268-296-324');
    expect(resolveText(cast.text, p.sizes, 2)).toContain('Cast on 248 sts');
    expect(detectSuggestions(cast.text, 6)[0]).toMatchObject({ kind: 'stitch', values: ['208', '228', '248', '268', '296', '324'] });
  });
  it('wrapped "Row 1 (RS)" lines become a 2-row stitch pattern', () => {
    const m1 = p.stitchPatterns[0];
    expect(m1.rows.map((r) => r.side)).toEqual(['RS', 'WS']);
    expect(m1.rows[0].text).toMatch(/psso, K1\.$/);
    expect(m1.repeatFrom).toBe(1);
  });
  it('size-labelled list stays one instruction', () => {
    const b = p.instructions.find((i) => i.text.startsWith('Make buttonholes when piece measures'))!;
    expect(b.text.split('\n').filter((l) => /^SIZE /.test(l))).toHaveLength(6);
  });
  it('measurement-based AT THE SAME TIME is flagged, not guessed', () => {
    const flagged = p.instructions.filter((i) => /AT THE SAME TIME/.test(i.text));
    expect(flagged.length).toBeGreaterThan(0);
    for (const i of flagged) expect(i.review?.join(' ')).toMatch(/cannot track/);
    expect(p.trackers).toHaveLength(0);
  });
});

const PASTE = 'fixtures/drops-244-8-pasted.txt';
describe.skipIf(!existsSync(PASTE))('copy-paste parser: DROPS No Nonsense Cardigan pasted from the website', async () => {
  const { parseTextFile } = await import('./pdf-node');
  const p = parseTextFile(PASTE);
  it('removes web chrome and finds the fields', () => {
    expect(p.sourceType).toBe('text');
    expect(p.title).toBe('No Nonsense Cardigan');
    expect(p.designer).toBe('DROPS Design');
    expect(p.sizes).toEqual(['S', 'M', 'L', 'XL', 'XXL', 'XXXL']);
    expect(p.measurements[0].cm).toEqual(['102', '110', '116', '128', '140', '152']);
    expect(p.measurements[0].inches?.[1]).toBe('43⅜');
    expect(p.yarn.description).toMatch(/DROPS AIR.*forest green/);
    expect(p.gauge).toMatchObject({ stitches: 17, rows: 22 });
    expect(p.needles).toMatch(/SIZE 5 MM = US 8/);
    expect(p.notions).toMatch(/537/);
    const all = p.instructions.map((i) => i.text).join('\n');
    expect(all).not.toMatch(/Videos|Lessons|Comments \(|related pattern|You might also like|Alternative Yarn|Product image|Charred/);
  });
  it('groups explanations and the piece under two parents', () => {
    const l1 = p.sections.filter((s) => s.level === 1).map((s) => s.title);
    expect(l1).toEqual(['EXPLANATIONS FOR THE PATTERN', 'START THE PIECE HERE']);
    expect(p.sections.filter((s) => s.parentId).map((s) => s.title)).toEqual(
      expect.arrayContaining(['YOKE', 'V-NECK', 'RAGLAN', 'BODY', 'SLEEVES', 'ASSEMBLY', 'GARTER STITCH (worked back and forth)']),
    );
  });
  it('resolves dash lists: cast on 68-68-68-74-74-74 for XL', () => {
    const ins = p.instructions.find((i) => i.text.startsWith('Cast on 68-68'))!;
    expect(resolveText(ins.text, p.sizes, 3)).toMatch(/Cast on 74 stitches/);
  });
  it('detects V-neck every 4th row 11-11-11-14-14-14 and flags the complex raglan sentences', () => {
    const t = p.trackers[0];
    expect(t.unit).toBe('row');
    const v = t.intervals.find((i) => i.label === 'V-neck')!;
    expect(v).toMatchObject({ every: 4, times: ['11', '11', '11', '14', '14', '14'], firstAssumed: true });
    expect(t.intervals.filter((i) => i.complex).length).toBeGreaterThan(0);
  });
  it('does not treat a 5-value list as a size list', () => {
    const ins = p.instructions.find((i) => /2-1-1-1-5/.test(i.text))!;
    expect(ins).toBeDefined();
    expect(resolveText(ins.text, p.sizes, 0)).toBe(ins.text);
  });
});
