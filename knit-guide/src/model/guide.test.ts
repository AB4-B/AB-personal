import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeResolution, guideInstruction, sizesFromHeading } from './guide';
import { projectFacts } from './facts';
import { findSizeGroups } from './size';
import type { Instruction, Pattern } from './types';

/** minimal pattern for synthetic cases */
function mini(texts: string[], sizes = ['S', 'M', 'L', 'XL', '2X', '3X']): Pattern {
  const instructions: Instruction[] = texts.map((t, i) => ({
    id: `i${i + 1}`, sectionId: 's1', kind: 'action', text: t, source: { page: 1, lines: [t], imageIds: [] },
  }));
  return { sizes, sections: [{ id: 's1', title: 'Body', level: 1 }], instructions, measurements: [], images: [], trackers: [], stitchPatterns: [], abbreviations: [] } as unknown as Pattern;
}

describe('guide: single-size, never guess', () => {
  const p = mini([
    'Provisional cast on 50 [50, 54, 54, 58] sts.',
    'Follow the Back Chart for 44 (50, 52, 58, 64, 66) rows.',
    'work 4-st pattern repeat 2 (2, 2, 3, 3, 3, 4) more times.',
    'Cast on 68-68-68-74-74-74 stitches.',
  ]);
  it('resolves every list that has one number per size', () => {
    expect(guideInstruction(p.instructions[1], { pattern: p, size: 'L', overrides: {} }).plain).toBe('Follow the Back Chart for 52 rows.');
    expect(guideInstruction(p.instructions[3], { pattern: p, size: 'XL', overrides: {} }).plain).toBe('Cast on 74 stitches.');
  });
  it('a 5-number list for 6 sizes is NOT resolved and is flagged', () => {
    const g = guideInstruction(p.instructions[0], { pattern: p, size: 'L', overrides: {} });
    expect(g.review).toHaveLength(1);
    expect(g.review[0].reason).toMatch(/5 numbers but there are 6 sizes/);
    expect(g.parts.some((x) => x.type === 'review')).toBe(true);
  });
  it('the 7-numbers-for-6-sizes list blocks automatic resolution', () => {
    const g = guideInstruction(p.instructions[2], { pattern: p, size: 'L', overrides: {} });
    expect(g.review).toHaveLength(1);
    expect(g.review[0].values).toEqual(['2', '2', '2', '3', '3', '3', '4']);
    expect(g.review[0].reason).toMatch(/7 numbers but there are 6 sizes/);
    expect(analyzeResolution(p, 'L').needsReview.length).toBeGreaterThan(0);
  });
  it('a project override is used everywhere and the source is untouched', () => {
    const key = guideInstruction(p.instructions[2], { pattern: p, size: 'L', overrides: {} }).review[0].key;
    const g = guideInstruction(p.instructions[2], { pattern: p, size: 'L', overrides: { [key]: '3' } });
    expect(g.review).toHaveLength(0);
    expect(g.plain).toBe('work 4-st pattern repeat 3 more times.');
    expect(p.instructions[2].text).toContain('2 (2, 2, 3, 3, 3, 4)');
  });
  it('an unlisted size never gets a number from another size', () => {
    const g = guideInstruction(p.instructions[1], { pattern: p, size: 'XXXL', overrides: {} });
    expect(g.review).toHaveLength(1);
  });
});

describe('guide: size-specific headings and lines', () => {
  it('parses the sizes a heading is written for', () => {
    const sizes = ['S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
    expect(sizesFromHeading('SIZES S, M, XL, XXL and XXXL (the increases in size L are finished)', sizes)).toEqual(['S', 'M', 'XL', 'XXL', 'XXXL']);
    expect(sizesFromHeading('SIZES M - XL', sizes)).toEqual(['M', 'L', 'XL']);
    expect(sizesFromHeading('SIZES S, Q', sizes)).toBeUndefined();
    expect(sizesFromHeading('ALL SIZES', sizes)).toBeUndefined();
  });
  it('hides instructions under a heading for other sizes, maps its own short list', () => {
    const p = mini(['increase on the body every 2nd row 2-1-1-1-5 times.']);
    p.sizes = ['S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
    p.sections[0].appliesTo = ['S', 'M', 'XL', 'XXL', 'XXXL'];
    expect(guideInstruction(p.instructions[0], { pattern: p, size: 'L', overrides: {} }).hidden).toBe(true);
    expect(guideInstruction(p.instructions[0], { pattern: p, size: 'XL', overrides: {} }).plain).toBe('increase on the body every 2nd row 1 times.');
    expect(guideInstruction(p.instructions[0], { pattern: p, size: 'XXXL', overrides: {} }).plain).toContain('every 2nd row 5 times');
  });
  it('SIZE S: … / SIZE M: … keeps only my size, with no label and no other sizes', () => {
    const t = 'Make buttonholes when piece measures:\nSIZE S: 8, 16 cm / 3", 6¼"\nSIZE M: 10, 18 cm / 4", 7"\nSIZE L: 8, 15 cm / 3", 6"';
    const p = mini([t], ['S', 'M', 'L']);
    const g = guideInstruction(p.instructions[0], { pattern: p, size: 'M', overrides: {} });
    expect(g.plain).toBe('Make buttonholes when piece measures:\n10, 18 cm');
    expect(g.plain).not.toMatch(/SIZE|\b8, 16\b|\b8, 15\b/);
  });
});

describe('guide: metric only', () => {
  it('shows the designer metric, hides imperial, converts imperial-only', () => {
    const p = mini(['Work until piece measures 12 inches.', 'Band measures 17-17-17-19-19-19 cm = 6¾"-6¾"-6¾"-7½"-7½"-7½".', 'Use US 6 needles.']);
    const ctx = { pattern: p, size: 'L', overrides: {} };
    expect(guideInstruction(p.instructions[0], ctx).plain).toBe('Work until piece measures 30.5 cm.');
    expect(guideInstruction(p.instructions[1], ctx).plain).toBe('Band measures 17 cm.');
    expect(guideInstruction(p.instructions[2], ctx).plain).toBe('Use 4 mm needles.');
  });
  it('flags a metric/imperial disagreement instead of choosing', () => {
    const p = mini(['Work until the piece measures 44 inches (90 cm).']);
    const g = guideInstruction(p.instructions[0], { pattern: p, size: 'L', overrides: {} });
    expect(g.measurementFlags).toHaveLength(1);
  });
});

const ABC = 'fixtures/raglan-lace-cardigan.pdf';
describe.skipIf(!existsSync(ABC))('ACCEPTANCE: ABC cardigan, size L, walk every guided instruction', async () => {
  const { parsePdfFile } = await import('../parser/pdf-node');
  const { finalizePattern } = await import('../parser/edit');
  const raw = await parsePdfFile(ABC);
  const p = finalizePattern(raw);
  const ctx = { pattern: p, size: 'L', overrides: {} as Record<string, string> };
  const guided = p.instructions.filter((i) => i.kind !== 'tracker').map((i) => ({ ins: i, g: guideInstruction(i, ctx) }));

  it('no multi-size list the parser knows about survives in the guided text', () => {
    for (const { ins, g } of guided) {
      if (g.hidden || g.review.length) continue;
      for (const grp of findSizeGroups(ins.text, p.sizes.length)) {
        expect(g.plain, `"${grp.raw}" leaked into: ${g.plain}`).not.toContain(grp.raw);
      }
      expect(g.plain).not.toMatch(/\d+\s*\[\s*\d+,/);
      expect(g.plain).not.toMatch(/\d+\s*\(\s*\d+,\s*\d+/);
    }
  });
  it('the exact examples from the brief do not appear, the L values do', () => {
    const all = guided.map((x) => x.g.plain).join('\n');
    for (const bad of ['50 [50, 54, 54, 54, 58]', '44 (50, 52, 58, 64, 66)', '11 (11, 13, 13, 12, 14)', '6 (8, 10, 12, 15, 17)']) expect(all).not.toContain(bad);
    expect(all).toContain('Provisional cast on 54 sts.');
    expect(all).toMatch(/Follow the Back Chart for 52 rows|Continue to follow the Back Chart for 52 rows/);
    expect(all).toContain('every 4th row 13 times');
    expect(all).toMatch(/cast on 10 sts with single cast on/);
    expect(all).toMatch(/pick up 10 sts/);
  });
  it('the ambiguous 7-number list is blocked and flagged, not guessed', () => {
    const amb = guided.find((x) => x.ins.text.includes('2 (2, 2, 3, 3, 3, 4)'))!;
    expect(amb.g.review).toHaveLength(1);
    expect(amb.g.parts.some((x) => x.type === 'review')).toBe(true);
    expect(amb.g.plain).toContain('2 (2, 2, 3, 3, 3, 4)'); // only inside the review box, as the exact original
  });
  it('SIZE RESOLUTION: counts what is resolved and what needs review, and clears with an override', () => {
    const r = analyzeResolution(p, 'L');
    expect(r.resolved).toBeGreaterThan(8);
    expect(r.needsReview).toHaveLength(1);
    const key = r.needsReview[0].review.key;
    const r2 = analyzeResolution(p, 'L', { [key]: '3' });
    expect(r2.needsReview).toHaveLength(0);
    expect(r2.resolved).toBe(r.resolved + 1);
  });
  it('VIEW ORIGINAL: the untouched multi-size source instruction is still in the pattern', () => {
    const src = raw.instructions.find((i) => i.text.startsWith('Provisional cast on'))!;
    expect(src.text).toBe('Provisional cast on 50 [50, 54, 54, 54, 58] sts.');
    expect(raw.instructions.find((i) => i.text.startsWith('Continue to follow the Back Chart'))!.text).toContain('44 (50, 52, 58, 64, 66)');
  });
  it('PROJECT DATA: metric, selected size only', () => {
    const f = projectFacts(p, 'L');
    expect(f.measurements[0]).toMatchObject({ value: '110 cm' });
    expect(f.needles).toBe('4 mm');
    expect(f.gauge).toBe('16 sts × 21 rows = 10 × 10 cm');
    expect(f.yarn).toBe('800 m');
    expect(f.flags).toEqual([]);
    const shown = [...f.measurements.map((m) => m.value), f.needles, f.gauge, f.yarn].join(' | ');
    expect(shown).not.toMatch(/inch|["”]|\bin\b|\b44\b/);
  });
});

const PASTE = 'fixtures/drops-244-8-pasted.txt';
describe.skipIf(!existsSync(PASTE))('DROPS paste: sections for other sizes are hidden, short lists map to their own sizes', async () => {
  const { parseTextFile } = await import('../parser/pdf-node');
  const p = parseTextFile(PASTE);
  it('"SIZES S, M, XL, XXL and XXXL" section is invisible for L and mapped for XL', () => {
    const sec = p.sections.find((s) => s.title.startsWith('SIZES S, M'))!;
    expect(sec.appliesTo).toEqual(['S', 'M', 'XL', 'XXL', 'XXXL']);
    const ins = p.instructions.find((i) => i.sectionId === sec.id && /2-1-1-1-5/.test(i.text))!;
    expect(guideInstruction(ins, { pattern: p, size: 'L', overrides: {} }).hidden).toBe(true);
    const xl = guideInstruction(ins, { pattern: p, size: 'XL', overrides: {} });
    expect(xl.plain).toMatch(/\) 1 times\./);
    expect(xl.plain).not.toMatch(/2-1-1-1-5/);
  });
  it('facts in metric: needles in mm, yarn in grams', () => {
    const f = projectFacts(p, 'L');
    expect(f.needles).toBe('5 mm, 4 mm');
    expect(f.yarn).toBe('450 g');
    expect(f.measurements[0].value).toBe('116 cm');
  });
});
