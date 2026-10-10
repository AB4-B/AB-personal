/**
 * Everyday knitting vocabulary. Each case says what must come out: the steps, the stitch count that follows, and
 * above all that anything not understood is flagged instead of guessed.
 */
import { describe, expect, it } from 'vitest';
import { prefsOf } from './flow';
import { translate } from './translate';

const run = (text: string, stitches?: number, construction: 'flat' | 'round' = 'flat') => translate(text, { prefs: prefsOf({} as never), sectionTitle: '', stitches, construction } as never);
const text = (t: ReturnType<typeof run>) => t.steps.map((s) => s.text).join(' | ');

describe('abbreviations and counted rows', () => {
  it('k2tog tbl, BO and CO', () => {
    expect(text(run('K2tog tbl, k1.', 40))).toMatch(/together through the back loops/);
    expect(run('K2tog tbl, k1.', 40).next.stitches).toBe(39);
    const bo = run('BO 10 sts, knit to end.', 80);
    expect(text(bo)).toMatch(/Bind off 10 stitches/);
    expect(bo.next.stitches).toBe(70);
    expect(text(run('CO 20 sts.'))).toMatch(/Cast on 20 stitches/);
  });
  it('knit / purl N rows, garter, stockinette and rib with counts', () => {
    expect(text(run('Purl 1 row.'))).toMatch(/Purl every stitch for 1 row/);
    expect(text(run('Work in garter stitch for 4 rows.'))).toMatch(/4 rows in garter stitch\. Knit every stitch/);
    // stockinette is NOT "knit every row"
    expect(text(run('Work 6 rows in stockinette stitch.'))).toMatch(/Knit the right-side rows and purl the wrong-side rows/);
    expect(text(run('Work 6 rounds in stockinette stitch.', undefined, 'round'))).toMatch(/Knit every round/);
    expect(text(run('Work 4 rounds in 2x2 rib.', 80, 'round'))).toMatch(/knit 2, purl 2/);
  });
  it('"work N rows" with no stitch named is not guessed', () => {
    expect(run('Work 4 rows.').review).toBe(true);
  });
});

describe('repeats', () => {
  it('rep from * with the usual single opening star, to end', () => {
    const r = run('*K2, p2; rep from * to end.', 80);
    expect(r.review).toBe(false);
    expect(text(r)).toMatch(/Repeat this until the end/);
  });
  it('to last st, and across', () => {
    const r = run('K1, *yo, k2tog; rep from * to last st, k1.', 81);
    expect(r.review).toBe(false);
    expect(text(r)).toMatch(/until 1 stitch remains/);
    expect(run('K1, p1 across.', 80).review).toBe(false);
  });
  it('a repeat that does not fit the stitches on the needle is reported, not hidden', () => {
    const fits = run('*K2, p2; rep from * to end.', 80);
    expect(fits.assumptions.join(' ')).not.toMatch(/does not fit/);
    const odd = run('*K2, p2; rep from * to end.', 82);
    expect(odd.assumptions.join(' ')).toMatch(/does not fit evenly into your 82 stitches/);
  });
  it('bracketed repeat "around" works out the stitch count and checks it against the designer', () => {
    const ok = run('[k8, k2tog] around [54 sts]', 60, 'round');
    expect(ok.review).toBe(false);
    expect(ok.next.stitches).toBe(54);
    expect(ok.assumptions.join(' ')).not.toMatch(/Check/);
    const wrong = run('[k8, k2tog] around [50 sts]', 60, 'round');
    expect(wrong.assumptions.join(' ')).toMatch(/but the pattern says 50/);
  });
});

describe('evenly spaced increases and decreases', () => {
  it('decreases use the stitches on the needle and add up exactly', () => {
    const r = run('Decrease 8 sts evenly across the round. [72 sts]', 80, 'round');
    expect(r.review).toBe(false);
    expect(text(r)).toMatch(/8 × \(knit 8, k2tog\)/);
    expect(r.next.stitches).toBe(72);
  });
  it('uneven spacing is shared out and still uses every stitch', () => {
    const r = run('Decrease 6 stitches evenly across the next row.', 83);
    expect(text(r)).toMatch(/Spacing \(calculated by Knit Guide from your 83 stitches\)/);
    expect(r.next.stitches).toBe(77);
    // (a gaps of lo or lo+1 plain stitches) × decreases + 2 per decrease = 83
    const m = [...text(r).matchAll(/(\d+) × \(knit (\d+), k2tog\)/g)];
    expect(m.reduce((n, x) => n + Number(x[1]) * (Number(x[2]) + 2), 0)).toBe(83);
  });
  it('a stated total that disagrees with the arithmetic is flagged', () => {
    const r = run('Increase 8 sts evenly across the row. [90 sts]', 80);
    expect(r.assumptions.join(' ')).toMatch(/but the pattern says 90/);
  });
  it('without a known stitch count the spacing is not invented', () => {
    expect(run('Inc 8 sts evenly spaced across the row.').review).toBe(true);
    expect(run('Dec 4 sts evenly across the row.').review).toBe(true);
  });
});

describe('short rows', () => {
  it('wrap and turn: the method follows the side facing you', () => {
    const rs = text(run('Row 1 (RS): K to last 3 sts, w&t.', 80));
    expect(rs).toMatch(/with the yarn at the back/);
    const ws = text(run('Row 2 (WS): P to last 3 sts, w&t.', 80));
    expect(ws).toMatch(/with the yarn at the front/);
    expect(text(run('Short row 1 (RS): K20, wrap and turn.', 80))).toMatch(/Knit the next 20 stitches[\s\S]*Wrap and turn/);
  });
  it('without a labelled side, both methods are shown and labelled (nothing is picked for you)', () => {
    const t = text(run('K20, w&t.', 80));
    expect(t).toMatch(/If the right side is facing you/);
    expect(t).toMatch(/If the wrong side is facing you/);
  });
  it('German short rows (double stitch): different method on RS and WS rows', () => {
    const rs = text(run('Short row 3 (RS): double the stitch, knit to 5 sts before doubled st, turn work.', 80));
    const ws = text(run('Short row 2 (WS): double the stitch, purl to CB, SM, turn work.', 80));
    expect(rs).toMatch(/bring the yarn between the needle tips to the right side/);
    expect(ws).toMatch(/with the yarn on the wrong side, slip/);
    expect(rs).not.toBe(ws);
  });
  it('the closing round that works doubled stitches together', () => {
    const r = run('Next round: double the stitch, knit to CB, SM, then work one complete round, working each of the doubled sts together to form a single stitch using k2tog, and keeping garter panels in pattern.', 248, 'round');
    expect(r.review).toBe(false);
    expect(text(r)).toMatch(/work its two loops together as ONE stitch using k2tog/);
  });
});

describe('shaping words', () => {
  it('(k1, yo, k1) in next st adds 2 stitches', () => {
    const r = run('(K1, yo, k1) in next st.', 40);
    expect(r.next.stitches).toBe(42);
  });
  it('slip to holder and bind off at the start of rows', () => {
    expect(run('Slip next 12 sts onto holder.', 80).next.stitches).toBe(68);
    const b = run('Bind off 5 sts at beginning of next 2 rows.', 80);
    expect(b.next.stitches).toBe(70);
    expect(text(b)).toMatch(/each of the next 2 rows/);
  });
});

describe('what is deliberately NOT guessed', () => {
  it('k1b / p1b (knit below or back loop depending on the designer), cables, charts', () => {
    expect(run('K1b, p1b.', 40).review).toBe(true);
    expect(run('C4F over next 4 sts.', 40).review).toBe(true);
    expect(run('Work Chart A for 20 rows.', 40).review).toBe(true);
  });
  it('"[2 sts dec]" is a change, never a stitch total', () => {
    const r = run('Knit to 2 sts before marker, k2tog, sm, ssk, knit to end. [2 sts dec]', undefined);
    expect(text(r)).not.toMatch(/you should have 2 stitches/);
    expect(r.checkpoint).toBeUndefined();
  });
});
