import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeResolution } from '../model/guide';
import { DEFAULT_PREFS, type Pattern, type Project } from '../model/types';
import { finalizePattern } from '../parser/edit';
import { parsePastedText } from '../parser/parse';
import { buildModel, describeKnit, yokeRow } from './flow';
import { events, planRow, summarize } from './plan';
import { constructionText, translate } from './translate';

const ctx0 = { prefs: DEFAULT_PREFS, sectionTitle: 'RIGHT BAND' };

function project(pattern: Pattern, size: string, extra: Partial<Project> = {}): Project {
  return {
    id: 'p', patternId: pattern.id, createdAt: 0, updatedAt: 0, name: 't', status: 'active', size,
    setup: { yarn: '', colour: '', needle: '', gaugeSts: '', gaugeRows: '', bodyLength: '', sleeveLength: '' },
    modifications: [], notes: [], counters: [], stitchCounters: [], trackers: {},
    progress: { completed: [], expanded: [], pdfPage: 1 }, ...extra,
  } as Project;
}

describe('translate: physical steps, not shorthand', () => {
  it('garter band, as in the brief', () => {
    const t = translate('Work GARTER STITCH until the band measures 17 cm, finishing after a row from the wrong side.', { ...ctx0, stitches: 7 });
    const text = t.steps.map((s) => s.text);
    expect(text).toEqual([
      'Knit all 7 stitches.',
      'Turn your work.',
      'Knit all 7 stitches back.',
      'Continue knitting every row like this until the band measures 17 cm.',
      'Make sure the final row you complete is a WRONG-SIDE row.',
    ]);
    expect(t.why[0]).toBe('Knitting every row creates garter stitch.');
    expect(t.construction).toBe('flat');
    expect(t.measurement?.target).toBe(17);
    expect(t.review).toBe(false);
  });
  it('lay aside + do not cast off', () => {
    const t = translate('Lay the piece to one side.', ctx0);
    expect(t.steps.map((s) => s.text).join(' ')).toMatch(/Put this piece aside.*Do NOT cast it off/);
  });
  it('k2, yo, ssk becomes five physical steps', () => {
    const t = translate('Row 1: k2, yo, ssk', ctx0);
    expect(t.steps.map((s) => s.text)).toEqual([
      'Row 1:',
      'Knit the next 2 stitches normally.',
      'Make 1 yarn over (bring the yarn to the front, then over the right needle).',
      'Slip the next stitch knitwise.',
      'Slip the following stitch knitwise.',
      'Knit those 2 slipped stitches together through the back (ssk).',
    ]);
    expect(t.steps.flatMap((s) => s.tech)).toEqual(expect.arrayContaining(['yo', 'ssk', 'slip']));
  });
  it('holding stitches and underarm cast-on are explained physically', () => {
    const t = translate('Work the first 36 stitches (front piece), place the next 38 stitches on a thread for the sleeve, cast on 10 stitches (in side under sleeve), work 54 stitches (back piece), place the next 38 stitches on a thread for the sleeve, cast on 10 stitches (in side under sleeve), work the last 36 stitches (front piece).', { ...ctx0, stitches: 202 });
    const all = t.steps.map((s) => s.text).join('\n');
    expect(all).toMatch(/Move the next 38 stitches off your working needle onto waste yarn or a stitch holder\. Do not knit these stitches\. These are your sleeve stitches and you will return to them later\./);
    expect(all).toMatch(/Cast on 10 new stitches over the gap/);
    expect(t.checkpoint?.expected).toBe(146);
    expect(t.assumptions).toEqual([]); // 36+38+54+38+36 = 202, matches
  });
  it('detects numbers that do not add up', () => {
    const t = translate('Work the first 30 stitches (front piece), place the next 38 stitches on a thread for the sleeve, cast on 10 stitches (in side under sleeve), work 54 stitches (back piece), place the next 38 stitches on a thread for the sleeve, cast on 10 stitches (in side under sleeve), work the last 36 stitches (front piece).', { ...ctx0, stitches: 202 });
    expect(t.assumptions.join(' ')).toMatch(/Recount/);
  });
  it('sleeve: in the round, Magic Loop by default (not DPNs), circular needle', () => {
    const t = translate('Place the 38 stitches from the thread on a short circular needle or double pointed needles size 4.5 mm and knit up 1 stitch in each of the 10 stitches cast on under the sleeve = 48 stitches.', { ...ctx0, sectionTitle: 'SLEEVES' });
    const all = t.steps.map((s) => s.text).join('\n');
    expect(t.construction).toBe('round');
    expect(all).toMatch(/Use Magic Loop with your circular needle\. The circumference is too small/);
    expect(all).not.toMatch(/double-pointed|DPN/i);
    expect(t.needs.join(' ')).toMatch(/4\.5 mm circular needle/);
    expect(t.checkpoint?.expected).toBe(48);
  });
  it('DPN preference is respected when chosen', () => {
    const t = translate('Change to double pointed needles size 3.5 mm and work rib (knit 1, purl 1) for 5 cm.', { prefs: { circular: true, smallCircumference: 'dpn' }, sectionTitle: 'SLEEVES' });
    expect(t.steps.map((s) => s.text).join(' ')).not.toMatch(/Magic Loop/);
  });
  it('flat work on circular needles stays flat and says so', () => {
    const c = constructionText('flat', DEFAULT_PREFS)!;
    expect(c.title).toBe('WORKING FLAT');
    expect(c.detail).toMatch(/Turn your work at the end of each row\. Do not join in the round\./);
    expect(c.detail).toMatch(/circular needle, but you are still working flat/);
    expect(constructionText('round', DEFAULT_PREFS)!.title).toBe('WORKING IN THE ROUND');
  });
  it('never invents steps: unknown wording → GUIDANCE NEEDS REVIEW with the original', () => {
    const t = translate('Fold the piece in half and graft the seam with a kitchener of your choosing.', ctx0);
    expect(t.review).toBe(true);
    expect(t.steps).toHaveLength(1);
    expect(t.steps[0].review).toBe(true);
    expect(t.steps[0].text).toMatch(/GUIDANCE NEEDS REVIEW/);
    expect(t.steps[0].original).toMatch(/Fold the piece in half/);
  });
  it('evenly spaced increases: spacing is calculated and labelled, count is exact', () => {
    const t = translate('Knit 1 row from the right side and increase 14 stitches evenly spaced (do not increase over the bands) = 160 stitches.', { ...ctx0, stitches: 146, band: 7 });
    const all = t.steps.map((s) => s.text).join('\n');
    expect(all).toMatch(/increase 14 stitches evenly across the next 132 stitches/);
    expect(all).toMatch(/calculated by Knit Guide/);
    const runs = [...all.matchAll(/(\d+) × \(knit (\d+), increase 1\)/g)];
    expect(runs.reduce((a, m) => a + Number(m[1]), 0)).toBe(14);
    expect(t.checkpoint?.expected).toBe(160);
  });
  it('needle sizes come out in mm only', () => {
    const t = translate('Cast on 7 stitches with circular needle size 4.5 mm and your yarn.', ctx0);
    expect(t.needs).toEqual(['4.5 mm circular needle', 'Your project yarn']);
  });
});

describe('simultaneous yoke rows (synthetic pattern, size L)', () => {
  const text = readFileSync('fixtures/synthetic-yoke-jacket.txt', 'utf8');
  const pattern = finalizePattern(parsePastedText(text, {}));
  const proj = project(pattern, 'L');
  const model = buildModel(pattern, proj);
  const yoke = model.list.find((g) => g.kind === 'yoke')!;

  it('size L resolves with nothing left to review', () => {
    expect(analyzeResolution(pattern, 'L').needsReview).toHaveLength(0);
  });
  it('builds ONE yoke plan from V-neck, raglan, size section and buttonholes', () => {
    expect(yoke).toBeDefined();
    const p = yoke.plan!;
    expect(p.band).toBe(7);
    expect(p.markerGaps).toEqual([9, 16, 18, 16, 9]);
    expect(p.startStitches).toBe(68);
    expect(p.vneck).toEqual({ every: 4, times: 9 });
    expect(p.raglanAll).toEqual({ every: 2, times: 4 });
    expect(p.body).toEqual({ every: 2, times: 14 });
    expect(p.sleeve).toEqual({ every: 4, times: 7 });
    expect(p.extraBody).toBe(0); // the "SIZES S and M" section does not apply to L
    expect(p.buttonholes).toMatchObject({ total: 4, offsetCm: 1, spacingCm: 7, leftAtEnd: 4 });
    expect(p.review).toEqual([]);
  });
  it("the pattern's own stitch totals check out (no guessing): 202 after the last increase", () => {
    expect(summarize(yoke.plan!, 1).finalStitches).toBe(202);
    expect(yoke.stitchesAfter).toBe(202);
  });
  it('size S uses the S-and-M section; its numbers also check out (180)', () => {
    const pS = buildModel(pattern, project(pattern, 'S')).list.find((g) => g.kind === 'yoke')!.plan!;
    expect(pS.extraBody).toBe(2);
    expect(summarize(pS, 1).finalStitches).toBe(180);
  });
  it('the instructions the plan handles are not separate steps', () => {
    expect(model.covered.size).toBeGreaterThanOrEqual(8);
    const v = pattern.instructions.find((i) => /^Increase for the neck/.test(i.text))!;
    expect(model.byId.get(v.id)!.kind).toBe('covered');
  });
  it('ROW 5: V-neck + raglan combined into one ordered instruction, with tracking and counts', () => {
    const r = planRow(yoke.plan!, 5, { vFirst: 1, bh: { done: 0, due: false } });
    expect(r.side).toBe('RS');
    expect(r.jobs).toEqual(['V-neck increases', 'Raglan increases']);
    const txt = r.steps.map((s) => s.text);
    expect(txt[0]).toBe('Work the first 7 band stitches in garter stitch (knit every stitch).');
    expect(txt[1]).toMatch(/V-neck increase.*left band/);
    expect(txt.filter((t) => t === 'Make 1 yarn over.').length).toBe(8); // 4 seams x 2 sides on a raglan-body row? see below
    expect(r.added).toBe(r.tracking.some((t) => t.label.includes('all four') && t.now) ? 10 : 6);
  });
  it('rows 1 and 5 are all-seam raglan + V-neck rows: +10 stitches each', () => {
    const p = yoke.plan!;
    const r1 = planRow(p, 1, { vFirst: 1, bh: { done: 0, due: false } });
    const r3 = planRow(p, 3, { vFirst: 1, bh: { done: 0, due: false } });
    const r5 = planRow(p, 5, { vFirst: 1, bh: { done: 0, due: false } });
    expect([r1.added, r3.added, r5.added]).toEqual([10, 8, 10]);
    expect(r1.before).toBe(68);
    expect(r3.before).toBe(78);
    expect(r5.before).toBe(86);
    expect(r5.after).toBe(96);
    const line = (r: ReturnType<typeof planRow>, l: string) => r.tracking.find((t) => t.label.startsWith(l))!;
    expect(line(r5, 'V-neck')).toMatchObject({ done: 2, total: 9, now: true });
    expect(line(r5, 'Raglan increase, all')).toMatchObject({ done: 3, total: 4, now: true });
    expect(r5.steps.map((s) => s.text).filter((t) => t === 'Make 1 yarn over.').length).toBe(8);
    expect(r5.steps.some((s) => /marker 4 \(right sleeve \| front\)/.test(s.text))).toBe(true);
  });
  it('a WRONG-SIDE row says there are no new increases, and what to twist', () => {
    const r = planRow(yoke.plan!, 6, { vFirst: 1, bh: { done: 0, due: false } });
    expect(r.side).toBe('WS');
    expect(r.noIncreases).toBe(true);
    expect(r.added).toBe(0);
    expect(r.jobs).toEqual([]);
    const all = r.steps.map((s) => s.text).join('\n');
    expect(all).toMatch(/through the back loop \(twisted\)/);
    expect(all).toMatch(/There are 10 yarn overs to work twisted on this row/);
    expect(all).toMatch(/Turn your work\./);
  });
  it('side alternates RS/WS and stitch counts only change on RS rows', () => {
    const p = yoke.plan!;
    let prev = p.startStitches;
    for (let row = 1; row <= 40; row++) {
      const r = planRow(p, row, { vFirst: 1, bh: { done: 0, due: false } });
      expect(r.side).toBe(row % 2 === 1 ? 'RS' : 'WS');
      expect(r.before).toBe(prev);
      if (r.side === 'WS') expect(r.added).toBe(0);
      prev = r.after;
    }
  });
  it('body and sleeve schedules differ: sleeves every 4th row, body every 2nd', () => {
    const ev = events(yoke.plan!, 1);
    const rs = (k: 'body' | 'sleeve') => [...ev].filter(([, e]) => e[k]).map(([r]) => r).sort((a, b) => a - b);
    expect(rs('body').slice(0, 3)).toEqual([9, 11, 13]);
    expect(rs('sleeve').slice(0, 3)).toEqual([9, 13, 17]);
    expect(rs('body')).toHaveLength(14);
    expect(rs('sleeve')).toHaveLength(7);
  });
  it('buttonholes: not due until I confirm a measurement; then exactly the physical steps; state advances', () => {
    const p = yoke.plan!;
    const lastV = summarize(p, 1).lastVneckRow; // 1 + 4*8 = 33
    expect(lastV).toBe(33);
    const before = planRow(p, 31, { vFirst: 1, bh: { done: 0, due: false } });
    expect(before.bhPrompt).toBeUndefined(); // V-neck not finished: rule not active yet
    const armed = planRow(p, 35, { vFirst: 1, bh: { done: 0, due: false } });
    expect(armed.bhPrompt?.text).toMatch(/Buttonhole 1 is due when the piece has grown 1 cm since your last V-neck increase row/);
    expect(armed.buttonhole).toBeUndefined(); // the app does not pretend to know the measurement
    const due = planRow(p, 35, { vFirst: 1, bh: { done: 0, due: true } });
    expect(due.buttonhole).toEqual({ n: 1, total: 4 });
    expect(due.jobs).toContain('Buttonhole');
    expect(due.steps.map((s) => s.text).join('\n')).toMatch(/Knit 3 of the band stitches in garter stitch, then: make 1 yarn over, knit 2 together, knit 2\. This is buttonhole 1 of 4\./);
    const hole = planRow(p, 36, { vFirst: 1, bh: { done: 1, due: false, justDone: true } });
    expect(hole.steps.map((s) => s.text).join('\n')).toMatch(/knit the buttonhole yarn over normally \(do NOT twist it\)/);
    const next = planRow(p, 37, { vFirst: 1, bh: { done: 1, due: false } });
    expect(next.bhPrompt?.text).toMatch(/Buttonhole 2 is due when the piece has grown about 7 cm since the last buttonhole/);
  });
  it('the row card is described for Quick Stop / resume', () => {
    const pr = project(pattern, 'L', {
      progress: { completed: [], expanded: [], pdfPage: 1, currentInstructionId: yoke.ins.id },
      trackers: { [yoke.spec!.id]: { row: 17, firstOverrides: {} } },
      knit: { stepsDone: { [`${yoke.spec!.id}:r17`]: [0, 1] }, checkpoints: {}, measured: {}, guidanceOverrides: {}, measurements: {} },
    });
    const d = describeKnit(pattern, pr)!;
    expect(d.headline).toEqual(['YOKE', 'Row 17', 'RIGHT SIDE', 'Working flat']);
    expect(d.tracking.join(' | ')).toMatch(/V-neck increase: 5 of 9/);
    expect(d.nextAction).toMatch(/^Knit until 1 stitch remains before marker 1/);
    expect(d.stitches).toBe(yokeRow(model.byId.get(yoke.ins.id)!, pr)!.before);
  });
});

describe('guided steps for the rest of the synthetic pattern (size L)', () => {
  const pattern = finalizePattern(parsePastedText(readFileSync('fixtures/synthetic-yoke-jacket.txt', 'utf8'), {}));
  const model = buildModel(pattern, project(pattern, 'L'));
  const by = (re: RegExp) => model.list.find((g) => re.test(g.ins.text))!;
  it('every instruction is either translated or explicitly flagged for review; none is silently skipped', () => {
    for (const g of model.list.filter((x) => x.kind === 'steps')) {
      expect(g.tr!.steps.length).toBeGreaterThan(0);
    }
    const unknown = model.list.filter((g) => g.kind === 'steps' && g.review).map((g) => g.ins.text);
    expect(unknown).toEqual([]); // the synthetic pattern is fully covered
  });
  it('bands: 16 cm, metric, flat; no multi-size list anywhere', () => {
    const g = by(/^Work GARTER STITCH until the band measures/);
    const all = g.tr!.steps.map((s) => s.text).join(' ');
    expect(all).toMatch(/band measures 16 cm/);
    expect(all).not.toMatch(/15-15-16-16|inch|"/);
    expect(g.construction).toBe('flat');
  });
  it('join: cast on 54 at the end of the row, 68 stitches, checkpoint', () => {
    const g = by(/^Cast on 50-50-54-54 stitches at the end/);
    expect(g.tr!.steps.map((s) => s.text).join(' ')).toMatch(/cast on 54 stitches onto your right-hand needle/);
    expect(g.tr!.checkpoint?.expected).toBe(68);
  });
  it('markers: placed one by one between stitches, with the running count', () => {
    const g = by(/^Count 9 stitches/);
    const t = g.tr!.steps.map((s) => s.text);
    expect(t[0]).toBe('Count 9 stitches from where you are.');
    expect(t[1]).toMatch(/Place marker 1 between that stitch and the next \(stitch 9 \| stitch 10\)/);
    expect(t.join('\n')).toMatch(/Place marker 4 between .* \(stitch 59 \| stitch 60\)/);
    expect(g.tr!.checkpoint?.expected).toBe(68);
  });
  it('divide, body, rib, sleeve are chained with correct stitch counts', () => {
    expect(by(/^Work the first 33-34-36-36/).stitchesAfter).toBe(146);
    expect(by(/^Knit 1 row from the right side/).stitchesAfter).toBe(160);
    expect(by(/^Place the 34-36-38-38 stitches from the thread/).stitchesAfter).toBe(48);
    const m = by(/^When the sleeve measures 3 cm/);
    expect(m.kind).toBe('measured');
    expect(m.measured).toMatchObject({ firstCm: 3, everyCm: 3, times: 8, delta: 2, end: 32 });
    expect(m.stitchesAfter).toBe(32);
    expect(m.eventSteps!.map((s) => s.text).join(' ')).toMatch(/Knit 2 stitches together \(k2tog\)/);
  });
  it('size-specific text for other sizes is absent', () => {
    expect(model.list.some((g) => /only increase on the body/.test(g.ins.text) && g.kind !== 'covered')).toBe(false);
  });
});

const DROPS = 'fixtures/drops-244-8-pasted.txt';
describe.skipIf(!existsSync(DROPS))('DROPS 244-8 (local fixture only, never committed)', () => {
  const pattern = finalizePattern(parsePastedText(readFileSync(DROPS, 'utf8'), {}));
  it('L: yoke plan reaches the pattern’s stated 308 stitches and the buttonhole rule is read', () => {
    const g = buildModel(pattern, project(pattern, 'L')).list.find((x) => x.kind === 'yoke')!;
    expect(g.plan!.review).toEqual([]);
    expect(g.plan!.startStitches).toBe(82);
    expect(summarize(g.plan!, 1).finalStitches).toBe(308);
    expect(g.plan!.buttonholes).toMatchObject({ total: 4, leftAtEnd: 4 });
    expect(g.plan!.endCm).toBe(29);
  });
  it('row 5 for L: V-neck 2 of 11, raglan 3 of 6', () => {
    const g = buildModel(pattern, project(pattern, 'L')).list.find((x) => x.kind === 'yoke')!;
    const r = planRow(g.plan!, 5, { vFirst: 1, bh: { done: 0, due: false } });
    expect(r.tracking.find((t) => t.label === 'V-neck increase')).toMatchObject({ done: 2, total: 11 });
    expect(r.tracking.find((t) => t.label.startsWith('Raglan increase, all'))).toMatchObject({ done: 3, total: 6 });
  });
  it('XL: the pattern’s stated body total (32) disagrees with its own schedule (33): flagged, not guessed', () => {
    const g = buildModel(pattern, project(pattern, 'XL')).list.find((x) => x.kind === 'yoke')!;
    expect(g.plan!.review.join(' ')).toMatch(/32 times on the body.*adds up to 33/);
    expect(g.plan!.review.join(' ')).toMatch(/324\) does match the schedule/);
  });
  it('sleeves in the round with Magic Loop; band 17 cm; no other sizes', () => {
    const m = buildModel(pattern, project(pattern, 'L'));
    const band = m.list.find((g) => /^Work GARTER STITCH/i.test(g.ins.text) || /^Work garter stitch until the band measures/.test(g.ins.text))!;
    expect(band.tr!.steps.map((s) => s.text).join(' ')).toMatch(/band measures 17 cm/);
    const sl = m.list.find((g) => /^Place the 50-54-58-58-62-62 stitches from the thread/.test(g.ins.text))!;
    expect(sl.tr!.steps.map((s) => s.text).join(' ')).toMatch(/Magic Loop/);
  });
  it('every size: one yoke plan, one measured sleeve plan, nothing unreviewed except what is flagged', () => {
    for (const size of ['S', 'M', 'L', 'XL', 'XXL', 'XXXL']) {
      const m = buildModel(pattern, project(pattern, size));
      expect(m.list.filter((g) => g.kind === 'yoke')).toHaveLength(1);
      const measured = m.list.filter((g) => g.kind === 'measured');
      expect(measured).toHaveLength(1);
      expect(measured[0].measured!.delta).toBe(2);
      const unreviewed = m.list.filter((g) => g.kind === 'steps' && g.review).map((g) => g.ins.text.slice(0, 60));
      expect(unreviewed, `size ${size}`).toEqual([]);
      for (const g of m.list) {
        const txt = (g.tr?.steps ?? []).map((x) => x.text).join(' ');
        expect(txt).not.toMatch(/\d+-\d+-\d+|["¼½¾⅜]|\bUS \d/);
      }
    }
  });
});
