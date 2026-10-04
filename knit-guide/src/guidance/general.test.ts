/**
 * The translator is a vocabulary, not a set of patterns: these synthetic patterns (a scarf, a blanket, a hat in the
 * round and a top-down raglan) are written in different styles and none of them may fall back to "needs review".
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Pattern, Project } from '../model/types';
import { finalizePattern } from '../parser/edit';
import { parsePastedText } from '../parser/parse';
import { buildModel, describeKnit } from './flow';
import { interpretSequence } from './ops';

function load(name: string): Pattern {
  return finalizePattern(parsePastedText(readFileSync(`fixtures/synthetic-${name}.txt`, 'utf8'), {}));
}
function project(p: Pattern, size: string, extra: Partial<Project> = {}): Project {
  return {
    id: 'p', patternId: p.id, createdAt: 0, updatedAt: 0, name: 't', status: 'active', size,
    setup: { yarn: '', colour: '', needle: '', gaugeSts: '', gaugeRows: '', bodyLength: '', sleeveLength: '' },
    modifications: [], notes: [], counters: [], stitchCounters: [], trackers: {},
    progress: { completed: [], expanded: [], pdfPage: 1 }, ...extra,
  } as Project;
}
const reviews = (p: Pattern, size: string) => buildModel(p, project(p, size)).list.filter((g) => g.review).map((g) => g.ins.text.slice(0, 70));

describe('stitch sequences', () => {
  it('translates a mixed sequence in order and counts the stitches', () => {
    const r = interpretSequence('k2, yo, ssk, knit to 3 sts before marker, k2tog, k1 [1 st inc]')!;
    expect(r.steps.map((s) => s.text)).toEqual([
      'Knit the next 2 stitches normally.',
      'Make 1 yarn over (bring the yarn to the front, then over the right needle).',
      'Slip the next stitch knitwise.',
      'Slip the following stitch knitwise.',
      'Knit those 2 slipped stitches together through the back (ssk).',
      'Knit until 3 stitches remain before the marker.',
      'Knit the next 2 stitches together (k2tog).',
      'Knit the next stitch normally.',
    ]);
    expect(r.delta).toBe(-1);
    expect(r.statedChange).toBe(1);
  });
  it('repeats: bracket groups, "twice", and star repeats', () => {
    const g = interpretSequence('[kfb, knit to marker, SM] 4 times [4 sts inc]')!;
    expect(g.steps[0].text).toBe('Do this 4 times:');
    expect(g.delta).toBe(4);
    const star = interpretSequence('k1, * p1, k1 *, work from *-* until 2 stitches remain, k2')!;
    expect(star.steps.some((s) => /Repeat this until 2 stitches remain/.test(s.text))).toBe(true);
  });
  it('refuses a sequence with an unknown part instead of guessing', () => {
    expect(interpretSequence('k2, C4F, k2')).toBeNull();
    expect(interpretSequence('knit the swirl braid')).toBeNull();
  });
  it('named knitting words: kfb, m1l, ssp, sk2p, double the stitch', () => {
    for (const t of ['kfb', 'M1L', 'M1R', 'ssp', 'sk2p', 'p2tog', 'sl1 wyif', 'double the stitch', 'PM', 'turn work', 'work in pattern to 3 sts before BOR marker']) {
      expect(interpretSequence(t), t).not.toBeNull();
    }
  });
});

describe('four kinds of project, one vocabulary', () => {
  it('scarf: ribbing repeated until it measures 160 cm', () => {
    const p = load('scarf');
    expect(p.sizes).toEqual(['One size']);
    expect(reviews(p, 'One size')).toEqual([]);
    const m = buildModel(p, project(p, 'One size'));
    const g = m.list.find((x) => x.tr?.parts?.some((q) => q.kind === 'repeat'))!;
    const block = g.tr!.parts!.flatMap((q) => (q.kind === 'repeat' ? [q.block] : []))[0];
    expect(block.until).toMatchObject({ cm: 160 });
    expect(block.times).toBeUndefined();
    expect(block.rounds).toHaveLength(2);
    expect(g.tr!.measurement?.target).toBe(160);
  });
  it('blanket: garter border, rows 1-2 repeated until 85 cm, one size', () => {
    const p = load('blanket');
    expect(p.sizes).toEqual(['One size']);
    expect(reviews(p, 'One size')).toEqual([]);
    const m = buildModel(p, project(p, 'One size'));
    const rep = m.list.flatMap((g) => g.tr?.parts ?? []).flatMap((q) => (q.kind === 'repeat' ? [q.block] : []));
    expect(rep).toHaveLength(1);
    expect(rep[0].until?.cm).toBe(85);
  });
  it('hat: child / adult sizes, join in the round, repeated decreases', () => {
    const p = load('hat');
    expect(p.sizes).toEqual(['Child', 'Adult S', 'Adult L']);
    expect(reviews(p, 'Adult S')).toEqual([]);
    const m = buildModel(p, project(p, 'Adult L'));
    const cast = m.list[0].tr!;
    expect(cast.steps.map((s) => s.text).join(' ')).toMatch(/Cast on 112 stitches/);
    expect(cast.steps.map((s) => s.text).join(' ')).toMatch(/Join in the round/);
    expect(cast.construction).toBe('round');
    const block = m.list.flatMap((g) => g.tr?.parts ?? []).flatMap((q) => (q.kind === 'repeat' ? [q.block] : []))[0];
    expect(block.times).toBe(8);
    expect(block.rounds.map((r) => r.delta)).toEqual([-2, 0]);
  });
  it('raglan: kfb rounds repeated with the designer\'s stated stitch count, sleeves from held stitches', () => {
    const p = load('raglan-sweater');
    for (const size of p.sizes) expect(reviews(p, size), size).toEqual([]);
    const m = buildModel(p, project(p, 'M'));
    const blocks = m.list.flatMap((g) => g.tr?.parts ?? []).flatMap((q) => (q.kind === 'repeat' ? [q.block] : []));
    expect(blocks[0]).toMatchObject({ times: 12, statedAfter: 184, before: 88 });
    expect(blocks[0].rounds.map((r) => r.delta)).toEqual([4, 0]);
    // the sleeve starts from its own 30 held + 6 picked up = 36, not from the body's count
    expect(blocks[1].before).toBe(36);
    expect(blocks[1].rounds.map((r) => r.delta)).toEqual([-2, 0, 0, 0, 0, 0]);
  });
});

describe('Quick Stop inside repeated rounds', () => {
  it('describes the round and repeat you are on', () => {
    const p = load('hat');
    const m0 = buildModel(p, project(p, 'Adult S'));
    const crown = m0.list.find((g) => g.tr?.parts?.some((q) => q.kind === 'repeat'))!;
    const pr = project(p, 'Adult S', {
      progress: { completed: [], expanded: [], pdfPage: 1, currentInstructionId: crown.ins.id },
      knit: { stepsDone: {}, checkpoints: {}, measured: {}, guidanceOverrides: {}, measurements: {}, phase: { [crown.ins.id]: { part: 0, rep: 2, idx: 1 } } },
    });
    const d = describeKnit(p, pr)!;
    expect(d.headline.join(' ')).toMatch(/Round 2 of 2/);
    expect(d.tracking.join(' ')).toMatch(/Repeat 3 of 8/);
  });
});

const FLAX = 'fixtures/flax-worsted.pdf';
describe.skipIf(!existsSync(FLAX))('Flax (local fixture only)', () => {
  it('almost every step is translated for sizes at both ends of the range', async () => {
    const { parsePdfFile } = await import('../parser/pdf-node');
    const p = finalizePattern(await parsePdfFile(FLAX));
    for (const size of ['0-6 mo', 'L', '6XL']) {
      const bad = reviews(p, size);
      expect(bad.length, `${size}: ${bad.join(' | ')}`).toBeLessThanOrEqual(2);
    }
  });
});

describe('the first step is the real cast-on', () => {
  const text = `Test Jacket
Designer: Test
SIZE: S - M - L

NEEDLES:
3.5 mm circular needle.

BUTTONHOLES:
Make buttonholes on the right band. 1 buttonhole = bind off 4th st and cast on 1 new st on the return row.

BODY PIECE:
Worked back and forth on circular needle from mid front.
Cast on 208- 228 -248 sts on circular needle size 3.5 mm with Cotton Viscose.
Work 8 rows garter st – see above.
`;
  it('starts at the cast-on sentence, not at a rule that merely mentions casting on', () => {
    const p = finalizePattern(parsePastedText(text, {}));
    const m = buildModel(p, project(p, 'M'));
    const real = m.list.filter((g) => g.kind === 'steps');
    expect(real[0].tr!.steps.map((s) => s.text)).toEqual(['Cast on 228 stitches.']);
    expect(real[0].tr!.needs.join(' ')).toMatch(/3\.5 mm circular needle/);
    expect(real[0].tr!.needs.join(' ')).toMatch(/Cotton Viscose/);
    expect(real[0].tr!.construction).toBe('flat');
    expect(m.list.find((g) => /buttonholes on the right band/i.test(g.ins.text))!.kind).toBe('info');
    expect(real[1].tr!.steps[0].text).toMatch(/Knit every stitch for 8 rows/);
  });
});
