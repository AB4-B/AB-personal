/**
 * Simultaneous-rule planners (built from the GUIDED text, so they are already single-size and metric).
 *
 *  YokePlan      : V-neck + raglan (all four seams, then body/sleeve schedules) + bands + buttonholes,
 *                  combined into ONE ordered instruction per row, with stitch counts that are checked
 *                  against the pattern's own stated totals.
 *  MeasuredPlan  : "when the sleeve measures X cm decrease…, then every Y cm, N times": events triggered by a
 *                  measurement the knitter confirms. Row counts are never invented from gauge.
 *
 * Source text is never touched. If the pieces needed are missing the plan is not built and the
 * instructions fall back to per-instruction guidance (or GUIDANCE NEEDS REVIEW).
 */
import { parseNumF } from '../model/units';
import type { MeasuredState } from '../model/types';
import { techniquesIn } from './techniques';
import type { TStep } from './translate';

export interface PlanItem {
  id: string;
  text: string;
  section: string;
}

export interface Rule {
  every: number;
  times: number;
}

export interface YokePlan {
  band: number;
  markerGaps: number[];
  vneck: Rule;
  raglanAll?: Rule;
  body?: Rule;
  sleeve?: Rule;
  extraBody: number;
  startStitches: number;
  finalStitches?: number;
  endCm?: number;
  totals?: { body: number; sleeve: number };
  buttonholes?: { offsetCm: number; spacingCm: number; total: number; leftAtEnd: number };
  sourceIds: string[];
  review: string[];
  assumptions: string[];
}

const ORD = '(?:st|nd|rd|th)';
const N = '(\\d+(?:\\.\\d+)?[¼½¾⅛⅜⅝⅞]?)';
const num = (s: string) => parseNumF(s);

/* ----------------------------------------------------------------- yoke */

export function buildYokePlan(items: PlanItem[]): YokePlan | undefined {
  const used = new Set<string>();
  const intro = new Set<string>();
  const find = <T>(re: RegExp, pick: (m: RegExpMatchArray) => T): { v: T; id: string } | undefined => {
    for (const it of items) {
      const m = it.text.match(re);
      if (m) {
        used.add(it.id);
        return { v: pick(m), id: it.id };
      }
    }
    return undefined;
  };

  const vneck = find(new RegExp(`increase for the (?:v-)?neck inside the bands every (\\d+)${ORD} row (\\d+) times`, 'i'), (m) => ({ every: Number(m[1]), times: Number(m[2]) }));
  const all = find(new RegExp(`increase on each side of (\\d+) stockinette stitches in each transition[^.]*? every (\\d+)${ORD} row (?:\\([^)]*\\) )?(\\d+) times`, 'i'), (m) => ({ every: Number(m[2]), times: Number(m[3]) }));
  const split = find(new RegExp(`increase on the front\\/back pieces every (\\d+)${ORD} row.*? and on the sleeves every (\\d+)${ORD} row`, 'i'), (m) => ({ b: Number(m[1]), s: Number(m[2]) }));
  const counts = find(/increase like this (\d+) times on the body \((\d+) times on the sleeves\)/i, (m) => ({ b: Number(m[1]), s: Number(m[2]) }));
  const extra = find(new RegExp(`only increase on the body every (\\d+)${ORD} row \\([^)]*\\) (\\d+) times`, 'i'), (m) => Number(m[2]));
  const totals = find(/you have increased a total of (\d+) times on the body and (\d+) times on the sleeves/i, (m) => ({ body: Number(m[1]), sleeve: Number(m[2]) }));
  const after = find(/after the last increase there are (\d+) stitches/i, (m) => Number(m[1]));
  const endCm = find(new RegExp(`until the yoke measures ${N} cm`, 'i'), (m) => num(m[1]));
  // intro sentences whose content is the schedule itself
  for (const it of items) {
    if (/^(?:continue back and forth with stockinette stitch and garter stitch over each band|at the same time increase for the (?:v-)?neck and raglan as described below|read the next \d+ sections before continuing|start mid-front, from the right side)\.?$/i.test(it.text) || /begin working the buttonholes/i.test(it.text)) intro.add(it.id);
  }
  const markers = items.find((i) => /count \d+ stitches?,? (?:insert|place) .*marker/i.test(i.text));
  const bhFirst = find(new RegExp(`first buttonhole is worked ${N} cm after the last increase for the (?:v-)?neck`, 'i'), (m) => num(m[1]));
  const bhRest = find(new RegExp(`the other (\\d+) buttonholes with approx\\. ${N} cm between each one`, 'i'), (m) => ({ others: Number(m[1]), spacing: num(m[2]) }));
  const bhEnd = find(/when there are (\d+) stitches left on the row as follows/i, (m) => Number(m[1]));
  const bandItem = items.find((i) => /band/i.test(i.section) && /^cast on (\d+) stitches/i.test(i.text));
  const band = bandItem ? Number(bandItem.text.match(/^cast on (\d+)/i)![1]) : undefined;

  if (!vneck || !(all || split) || !markers || !band) return undefined;
  const gaps = [...markers.text.matchAll(/count (\d+) stitches?,? (?:insert|place)/gi)].map((m) => Number(m[1]));
  const left = markers.text.match(/there are (\d+) stitches left/i);
  if (left) gaps.push(Number(left[1]));
  if (gaps.length !== 5) return undefined;
  const start = gaps.reduce((a, b) => a + b, 0);

  const plan: YokePlan = {
    band,
    markerGaps: gaps,
    vneck: vneck.v,
    raglanAll: all?.v,
    body: split && counts ? { every: split.v.b, times: counts.v.b } : undefined,
    sleeve: split && counts ? { every: split.v.s, times: counts.v.s } : undefined,
    extraBody: extra?.v ?? 0,
    startStitches: start,
    finalStitches: after?.v,
    endCm: endCm?.v,
    totals: totals?.v,
    buttonholes: bhFirst && bhRest && bhEnd ? { offsetCm: bhFirst.v, spacingCm: bhRest.v.spacing, total: bhRest.v.others + 1, leftAtEnd: bhEnd.v } : undefined,
    sourceIds: [...used, ...intro],
    review: [],
    assumptions: [
      'Increases are worked on right-side rows (the pattern says "each row from the right side").',
      'The first V-neck increase is assumed to be on row 1. You can change this in Adjust.',
    ],
  };
  if (split && !counts) plan.review.push('The body/sleeve raglan counts could not be read.');
  // the pattern states its own totals: use them as a checksum, never silently trust our arithmetic
  const sim = summarize(plan, 1);
  if (plan.totals) {
    const body = (plan.raglanAll?.times ?? 0) + (plan.body?.times ?? 0) + plan.extraBody;
    const sleeve = (plan.raglanAll?.times ?? 0) + (plan.sleeve?.times ?? 0);
    if (body !== plan.totals.body || sleeve !== plan.totals.sleeve) {
      const finalOk = plan.finalStitches !== undefined && sim.finalStitches === plan.finalStitches;
      plan.review.push(
        `The pattern says you increase ${plan.totals.body} times on the body and ${plan.totals.sleeve} on the sleeves, but its own schedule adds up to ${body} and ${sleeve}.` +
          (finalOk ? ` The stitch count it gives at the end (${plan.finalStitches}) does match the schedule, so the schedule is probably right. Confirm at the checkpoint.` : ''),
      );
    }
  }
  if (plan.finalStitches !== undefined && sim.finalStitches !== plan.finalStitches) {
    plan.review.push(`The pattern says you end with ${plan.finalStitches} stitches, but its increase schedule gives ${sim.finalStitches}. Recount at the checkpoint before you go on.`);
  }
  return plan;
}

export interface RowEvents {
  all?: boolean;
  body?: boolean;
  sleeve?: boolean;
  vneck?: boolean;
}

const stepOf = (every: number) => Math.max(1, Math.round(every / 2));

export function events(plan: YokePlan, vFirst = 1): Map<number, RowEvents> {
  const ev = new Map<number, RowEvents>();
  const at = (row: number) => {
    let e = ev.get(row);
    if (!e) ev.set(row, (e = {}));
    return e;
  };
  let n0 = 1;
  if (plan.raglanAll) {
    const st = stepOf(plan.raglanAll.every);
    for (let k = 0; k < plan.raglanAll.times; k++) at(2 * (1 + k * st) - 1).all = true;
    n0 = 1 + plan.raglanAll.times * st;
  }
  if (plan.body || plan.extraBody) {
    const st = stepOf(plan.body?.every ?? 2);
    const count = (plan.body?.times ?? 0) + plan.extraBody;
    for (let k = 0; k < count; k++) at(2 * (n0 + k * st) - 1).body = true;
  }
  if (plan.sleeve) {
    const st = stepOf(plan.sleeve.every);
    for (let k = 0; k < plan.sleeve.times; k++) at(2 * (n0 + k * st) - 1).sleeve = true;
  }
  for (let k = 0; k < plan.vneck.times; k++) {
    const row = vFirst + k * plan.vneck.every;
    if (row % 2 === 1) at(row).vneck = true;
  }
  return ev;
}

export const deltaOf = (e?: RowEvents) => (e ? (e.all ? 8 : 0) + (e.body ? 4 : 0) + (e.sleeve ? 4 : 0) + (e.vneck ? 2 : 0) : 0);

export function summarize(plan: YokePlan, vFirst = 1) {
  const ev = events(plan, vFirst);
  let last = 0;
  let total = plan.startStitches;
  for (const [row, e] of ev) {
    total += deltaOf(e);
    last = Math.max(last, row);
  }
  let lastV = 0;
  for (const [row, e] of ev) if (e.vneck) lastV = Math.max(lastV, row);
  return { finalStitches: total, lastEventRow: last, lastVneckRow: lastV, ev };
}

export interface TrackLine {
  label: string;
  done: number;
  total: number;
  now: boolean;
}

export interface PlannedRow {
  row: number;
  side: 'RS' | 'WS';
  jobs: string[];
  steps: TStep[];
  tracking: TrackLine[];
  before: number;
  added: number;
  after: number;
  plain: boolean;
  noIncreases: boolean;
  why: string[];
  /** increases for this plan are all finished once this row is done */
  lastIncreaseRow: boolean;
  increasesFinished: boolean;
  buttonhole?: { n: number; total: number };
  bhPrompt?: { n: number; total: number; text: string };
  holeThisRow?: boolean;
  yosToTwist: number;
  checkpoint?: { expected: number; label: string };
}

export interface PlanRowState {
  vFirst: number;
  bh: MeasuredState;
}

const SEAMS = [
  { n: 1, name: 'front | left sleeve', left: 'body' as const },
  { n: 2, name: 'left sleeve | back', left: 'sleeve' as const },
  { n: 3, name: 'back | right sleeve', left: 'body' as const },
  { n: 4, name: 'right sleeve | front', left: 'sleeve' as const },
];

function mk(text: string, review = false): TStep {
  return { text, tech: techniquesIn(text), review };
}

export function planRow(plan: YokePlan, row: number, st: PlanRowState): PlannedRow {
  const sum = summarize(plan, st.vFirst);
  const ev = sum.ev;
  const side: 'RS' | 'WS' = row % 2 === 1 ? 'RS' : 'WS';
  let before = plan.startStitches;
  for (const [r, e] of ev) if (r < row) before += deltaOf(e);
  const e = side === 'RS' ? ev.get(row) : undefined;
  const added = deltaOf(e);

  // progress counters (events done including this row if it has one)
  const doneUpTo = (key: keyof RowEvents) => {
    let k = 0;
    for (const [r, x] of ev) if (r <= row && x[key]) k++;
    return k;
  };
  const tracking: TrackLine[] = [];
  const raglanAllTotal = plan.raglanAll?.times ?? 0;
  const bodyTotal = (plan.body?.times ?? 0) + plan.extraBody;
  if (plan.vneck.times) tracking.push({ label: 'V-neck increase', done: doneUpTo('vneck'), total: plan.vneck.times, now: !!e?.vneck });
  if (raglanAllTotal) tracking.push({ label: 'Raglan increase, all four seams', done: doneUpTo('all'), total: raglanAllTotal, now: !!e?.all });
  if (bodyTotal) tracking.push({ label: 'Raglan increase, body side', done: doneUpTo('body'), total: bodyTotal, now: !!e?.body });
  if (plan.sleeve) tracking.push({ label: 'Raglan increase, sleeve side', done: doneUpTo('sleeve'), total: plan.sleeve.times, now: !!e?.sleeve });

  const lastIncreaseRow = sum.lastEventRow === row && !!e;
  const increasesFinished = row > sum.lastEventRow;

  // buttonholes
  const bhCfg = plan.buttonholes;
  const armed = !!bhCfg && row > sum.lastVneckRow;
  const bhDone = st.bh.done;
  const bhLeft = bhCfg ? bhCfg.total - bhDone : 0;
  const bhNow = !!bhCfg && armed && side === 'RS' && st.bh.due && bhLeft > 0;
  let bhPrompt: PlannedRow['bhPrompt'];
  if (bhCfg && armed && bhLeft > 0 && !bhNow) {
    bhPrompt = {
      n: bhDone + 1,
      total: bhCfg.total,
      text:
        bhDone === 0
          ? `Buttonhole 1 is due when the piece has grown ${fmt(bhCfg.offsetCm)} cm since your last V-neck increase row.`
          : `Buttonhole ${bhDone + 1} is due when the piece has grown about ${fmt(bhCfg.spacingCm)} cm since the last buttonhole.`,
    };
  }
  if (bhCfg) tracking.push({ label: 'Buttonhole', done: bhDone + (bhNow ? 1 : 0), total: bhCfg.total, now: bhNow });

  const jobs: string[] = [];
  if (e?.vneck) jobs.push('V-neck increases');
  if (e?.all || e?.body || e?.sleeve) jobs.push('Raglan increases');
  if (bhNow) jobs.push('Buttonhole');

  const steps: TStep[] = [];
  const why: string[] = [];
  const b = plan.band;
  const prevEvents = row > 1 ? ev.get(row - 1) : undefined;
  const prevAdded = row > 1 && (row - 1) % 2 === 1 ? deltaOf(prevEvents) : 0;
  const prevBh = st.bh.justDone && side === 'WS';

  if (side === 'RS') {
    steps.push(mk(`Work the first ${b} band stitches in garter stitch (knit every stitch).`));
    if (e?.vneck) steps.push(mk('Make 1 yarn over. This is the V-neck increase: it sits just inside the left band.'));
    SEAMS.forEach((s) => {
      const leftInc = !!(e?.all || (e?.body && s.left === 'body') || (e?.sleeve && s.left === 'sleeve'));
      const rightInc = !!(e?.all || (e?.body && s.left === 'sleeve') || (e?.sleeve && s.left === 'body'));
      if (leftInc || rightInc) {
        steps.push(mk(`Knit until 1 stitch remains before marker ${s.n} (${s.name}).`));
        if (leftInc) steps.push(mk('Make 1 yarn over.'));
        steps.push(mk(`Knit 1, move past marker ${s.n}, knit 1.`));
        if (rightInc) steps.push(mk('Make 1 yarn over.'));
      } else {
        steps.push(mk(`Knit to marker ${s.n} (${s.name}) and move past it. No increase here.`));
      }
    });
    if (e?.vneck) {
      steps.push(mk(`Knit until ${b} stitches remain (the right band).`));
      steps.push(mk('Make 1 yarn over. This is the second V-neck increase, just inside the right band.'));
    } else {
      steps.push(mk(`Knit until ${b} stitches remain (the right band).`));
    }
    if (bhNow && bhCfg) {
      steps.push(mk(`Knit ${b - bhCfg.leftAtEnd} of the band stitches in garter stitch, then: make 1 yarn over, knit 2 together, knit 2. This is buttonhole ${bhDone + 1} of ${bhCfg.total}.`));
    } else {
      steps.push(mk(`Work the last ${b} band stitches in garter stitch.`));
    }
    steps.push(mk('Turn your work.'));
    why.push(
      e?.all
        ? 'These increases make room for the body and both sleeves as the yoke grows.'
        : e?.body || e?.sleeve
          ? 'Different seams grow at different rates so the sleeves end up narrower than the body.'
          : 'A plain right-side row: the shaping happens on the rows you counted earlier.',
    );
    if (e?.vneck) why.push('The V-neck increases widen the neckline as it slopes down the front.');
  } else {
    steps.push(mk(`Work the first ${b} band stitches in garter stitch (knit).`));
    steps.push(mk('Purl across all body and sleeve stitches (stockinette), moving past the 4 markers.'));
    const yos = prevAdded - (st.bh.justDone ? 0 : 0);
    if (yos > 0) steps.push(mk(`When you reach a yarn over from the previous row, purl it through the back loop (twisted) so it does not leave a hole. There are ${yos} yarn overs to work twisted on this row.`));
    if (prevBh) steps.push(mk('Near the end, knit the buttonhole yarn over normally (do NOT twist it) so it leaves a hole.'));
    steps.push(mk(`Work the last ${b} band stitches in garter stitch.`));
    steps.push(mk('Turn your work.'));
    if (yos > 0) why.push('Working a yarn over twisted closes the hole so the increase is nearly invisible.');
  }

  return {
    row,
    side,
    jobs,
    steps,
    tracking,
    before,
    added,
    after: before + added,
    plain: !e,
    noIncreases: added === 0,
    why,
    lastIncreaseRow,
    increasesFinished,
    buttonhole: bhNow && bhCfg ? { n: bhDone + 1, total: bhCfg.total } : undefined,
    bhPrompt,
    holeThisRow: prevBh,
    yosToTwist: side === 'WS' ? prevAdded : 0,
    checkpoint: lastIncreaseRow && plan.finalStitches !== undefined ? { expected: before + added, label: 'after the last increase' } : undefined,
  };
}

const fmt = (x: number) => String(Number(x.toFixed(1)));

/* ------------------------------------------------------- measured events */

export interface MeasuredPlan {
  anchorId: string;
  coveredIds: string[];
  firstCm: number;
  everyCm: number;
  times: number;
  delta: number;
  end?: number;
}

export function findMeasuredPlans(items: PlanItem[]): MeasuredPlan[] {
  const out: MeasuredPlan[] = [];
  for (let i = 0; i < items.length - 1; i++) {
    const a = items[i].text.match(new RegExp(`^when the (\\w+) measures ${N} cm,? decrease (\\d+) stitches`, 'i'));
    const b = items[i + 1].text.match(new RegExp(`^decrease like this every ${N} cm(?: = [^a]*?)? a total of (\\d+) times(?: = (\\d+) stitches)?`, 'i'));
    if (a && b) {
      out.push({
        anchorId: items[i].id,
        coveredIds: [items[i + 1].id],
        firstCm: num(a[2]),
        everyCm: num(b[1]),
        times: Number(b[2]),
        delta: Number(a[3]),
        end: b[3] ? Number(b[3]) : undefined,
      });
    }
  }
  return out;
}

/** The measurement at which event number `k` (0-based) is due. Computed from the pattern's own numbers. */
export const dueCm = (p: MeasuredPlan, k: number) => p.firstCm + k * p.everyCm;
