/**
 * Plain-physical-action translator.
 *
 * Input : the GUIDED text of one instruction (selected size only, metric only; see model/guide.ts).
 * Output: numbered physical steps, what you need, a short WHY, flat/round, checkpoints, measurement conditions.
 *
 * Rules, not guesses: each sentence must match a known construction. A sentence that matches nothing
 * becomes a blocking "GUIDANCE NEEDS REVIEW" step that carries the original wording. The source pattern
 * is never modified.
 */
import { parseNumF } from '../model/units';
import { splitAtSentences } from '../model/text';
import type { KnitPrefs } from '../model/types';
import { techniquesIn } from './techniques';
import { explain } from '../engine/explain';
import { interpretSequence, stripNotes } from './ops';

export type Construction = 'flat' | 'round';

export interface TCtx {
  prefs: KnitPrefs;
  sectionTitle: string;
  construction?: Construction;
  /** stitches on the needle right now, when known */
  stitches?: number;
  /** stitches of another piece lying aside (e.g. the first band) */
  aside?: number;
  /** garter band width in stitches */
  band?: number;
  lastCastOn?: number;
  /** the side of the row that was completed last, when known */
  lastSide?: 'RS' | 'WS';
}

export interface TStep {
  text: string;
  tech: string[];
  /** blocking: the guide could not translate this safely */
  review?: boolean;
  original?: string;
  /** an explanation, not an action: shown as plain text without a tick */
  note?: boolean;
}

export interface RepeatRound {
  label: string;
  steps: TStep[];
  /** stitches gained or lost in this round, when it can be worked out */
  delta?: number;
}

/** "Round 1 … Round 2 … Work rounds 1-2 a total of 7 times": rounds that repeat, counted for you. */
export interface RepeatBlock {
  unit: 'round' | 'row';
  rounds: RepeatRound[];
  /** how many times; undefined when the pattern repeats until a measurement */
  times?: number;
  /** "repeat rows 1-2 until the scarf measures 160 cm" */
  until?: { cm: number; what: string; from?: string };
  /** stitches on the needle before the first repeat, and the designer's stated count after the last */
  before?: number;
  statedAfter?: number;
}

export type TPart = { kind: 'steps'; steps: TStep[] } | { kind: 'repeat'; block: RepeatBlock };

export interface MeasurementCheck {
  key: string;
  target: number;
  label: string;
  from: string;
}

export interface Translation {
  steps: TStep[];
  why: string[];
  needs: string[];
  construction?: Construction;
  checkpoint?: { expected: number; label: string };
  measurement?: MeasurementCheck;
  /** state for following instructions */
  next: Partial<Pick<TCtx, 'stitches' | 'aside' | 'band' | 'lastCastOn' | 'lastSide'>>;
  assumptions: string[];
  review: boolean;
  /** in order, when the instruction contains a repeat block; otherwise the steps are the whole instruction */
  parts?: TPart[];
  magicLoop?: boolean;
  /** sentence consumed as a row guide / schedule elsewhere */
  info?: boolean;
}

interface Acc extends Translation {
  ctx: TCtx;
  held: number;
}

const num = (s: string) => parseNumF(s);
const n = (s: string) => num(s.replace(/\.$/, ''));
const sts = (k: number) => (k === 1 ? '1 stitch' : `${k} stitches`);
const fmtCm = (x: number) => String(Number(x.toFixed(1)));

function step(a: Acc, text: string, extra: Partial<TStep> = {}) {
  a.steps.push({ text, tech: techniquesIn(text), ...extra });
}

/* --------------------------------------------------------------- needles */

interface Needle {
  mm?: string;
  type?: 'circular' | 'dpn' | 'straight' | 'short';
}
export function needleFrom(text: string): Needle {
  const mm = text.match(/(?:size\s+)?(\d+(?:\.\d+)?)\s*mm/i)?.[1];
  const t = text.toLowerCase();
  const type: Needle['type'] = /double[- ]pointed|dpn/.test(t)
    ? 'dpn'
    : /short circular/.test(t)
      ? 'short'
      : /straight/.test(t)
        ? 'straight'
        : /circular/.test(t)
          ? 'circular'
          : undefined;
  return { mm, type };
}

function needleNeeds(a: Acc, text: string, small: boolean) {
  const nd = needleFrom(text);
  if (!nd.mm) return;
  const mm = nd.mm.replace(/\.0$/, '');
  const prefs = a.ctx.prefs;
  if (small && (a.ctx.construction ?? a.construction) === 'round') {
    if (prefs.smallCircumference === 'dpn') a.needs.push(`${mm} mm double-pointed needles`);
    else a.needs.push(`${mm} mm circular needle, 80 cm or longer (for Magic Loop)`);
  } else {
    a.needs.push(prefs.circular || nd.type === 'circular' || !nd.type ? `${mm} mm circular needle` : `${mm} mm needles`);
  }
  if (nd.type === 'straight' && prefs.circular) a.needs.push('(The pattern says straight needles: use a circular needle instead. You still work back and forth.)');
}

function magicLoop(a: Acc, why?: string) {
  if (a.magicLoop) return;
  a.magicLoop = true;
  if (a.ctx.prefs.smallCircumference === 'magic-loop') {
    step(a, 'Use Magic Loop with your circular needle. The circumference is too small to sit around the cable normally.', { tech: ['magicloop'] });
  } else {
    step(a, 'Divide the stitches over your double-pointed needles and join in the round.');
  }
  if (why) a.why.push(why);
}

function flatNote(a: Acc) {
  a.construction = 'flat';
}
function roundNote(a: Acc) {
  a.construction = 'round';
}

/* ------------------------------------------------------------ recognizers */

type Rec = { name: string; re: RegExp; run: (m: RegExpMatchArray, a: Acc, s: string) => void };

const SIDE = (w: string) => (/wrong/i.test(w) ? 'WRONG-SIDE' : 'RIGHT-SIDE');

const RECOGNIZERS: Rec[] = [
  {
    name: 'cast-on',
    re: /^(provisional\s+)?cast on (\d+)(?: stitches| sts)?(?: with (.+?))?\.?$/i,
    run: (m, a) => {
      const k = Number(m[2]);
      const prov = !!m[1];
      step(a, prov ? `Cast on ${sts(k)} using a provisional cast-on (waste-yarn cast-on).` : `Cast on ${sts(k)}.`, { tech: prov ? ['provisional', 'cast'] : ['cast'] });
      if (m[3]) needleNeeds(a, m[3], false);
      if (m[3] && /yarn/i.test(m[3])) a.needs.push('Your project yarn');
      a.next.stitches = k;
      a.next.lastCastOn = k;
      a.checkpoint = { expected: k, label: 'cast-on' };
      if (/band/i.test(a.ctx.sectionTitle)) a.next.band = k;
      a.why.push('This is the starting edge of the piece.');
    },
  },
  {
    name: 'garter-until-measures',
    re: /^work garter (?:stitch|st)[^.]*? until (?:the )?(band|piece|work|strip)? ?measures (\d+(?:\.\d+)?[¼½¾]?) cm(?:,? finishing after a row from the (wrong|right) side)?\.?$/i,
    run: (m, a) => {
      const k = a.ctx.stitches;
      const target = n(m[2]);
      flatNote(a);
      const all = k ? `all ${k} stitches` : 'every stitch';
      step(a, `Knit ${all}.`);
      step(a, 'Turn your work.', { tech: ['turn'] });
      step(a, `Knit ${all} back.`);
      step(a, `Continue knitting every row like this until the ${m[1] ?? 'piece'} measures ${fmtCm(target)} cm.`, { tech: ['garter'] });
      if (m[3]) step(a, `Make sure the final row you complete is a ${SIDE(m[3])} row.`);
      a.measurement = { key: `len:${a.ctx.sectionTitle}:${fmtCm(target)}`, target, label: `${m[1] ?? 'piece'} length`, from: 'the cast-on edge (lay it flat, do not stretch it)' };
      a.why.push('Knitting every row creates garter stitch.');
      if (m[3]) a.next.lastSide = /wrong/i.test(m[3]) ? 'WS' : 'RS';
    },
  },
  {
    name: 'lay-aside',
    re: /^lay the piece to one side\.?$/i,
    run: (_m, a) => {
      step(a, 'Stop here.');
      step(a, 'Put this piece aside.');
      step(a, 'Do NOT cast it off. Leave the stitches on the needle (or slide them onto the cable or a holder) so they stay live.', { tech: ['hold'] });
      a.next.aside = a.ctx.stitches;
      a.why.push('You will come back to these stitches when you join the two bands.');
    },
  },
  {
    name: 'do-not-cut',
    re: /^do not cut the (?:strand|yarn)\.?$/i,
    run: (_m, a) => {
      step(a, 'Do not cut your yarn. Leave it attached to the work.');
    },
  },
  {
    name: 'cast-on-end-join',
    re: /^cast on (\d+) stitches at the end of this row,? then knit the (?:right )?band stitches = (\d+) stitches\.?$/i,
    run: (m, a) => {
      const add = Number(m[1]);
      const total = Number(m[2]);
      flatNote(a);
      const bandOther = a.ctx.aside ?? total - add - (a.ctx.stitches ?? 0);
      step(a, `At the end of this row, cast on ${sts(add)} onto your right-hand needle.`, { tech: ['cast'] });
      step(a, `Now pick up the band you put aside and knit across its ${sts(bandOther)}.`);
      step(a, `All stitches are now on one needle. You should have ${total} stitches.`);
      a.checkpoint = { expected: total, label: 'bands joined' };
      a.next.stitches = total;
      a.next.lastCastOn = add;
      a.next.lastSide = 'RS';
      a.why.push('This joins the two front bands with the stitches for the back of the neck between them.');
      if (a.ctx.stitches && a.ctx.aside && a.ctx.stitches + a.ctx.aside + add !== total) {
        a.assumptions.push(`Check: ${a.ctx.stitches} + ${a.ctx.aside} + ${add} is not ${total}. Recount before you go on.`);
      }
    },
  },
  {
    name: 'one-row-bands-purl-cast-on',
    re: /^work 1 row with garter stitch over each band and purling the cast-on stitches\.?$/i,
    run: (_m, a) => {
      const band = a.ctx.band;
      const mid = a.ctx.lastCastOn;
      flatNote(a);
      step(a, 'Turn your work.', { tech: ['turn'] });
      step(a, band ? `Knit the first ${sts(band)} (garter band).` : 'Knit the stitches of the first band (garter).');
      step(a, mid ? `Purl the ${mid} cast-on stitches.` : 'Purl the cast-on stitches.', { tech: ['purl'] });
      step(a, band ? `Knit the last ${sts(band)} (garter band).` : 'Knit the stitches of the last band (garter).');
      a.why.push('The bands are garter stitch; the stitches between them start as stockinette.');
      a.next.lastSide = 'WS';
    },
  },
  {
    name: 'insert-markers-intro',
    re: /^insert (\d+) marker-?threads?\b.*$/i,
    run: (m, a) => {
      const k = Number(m[1]);
      step(a, `You are going to place ${k} markers. Each one goes BETWEEN two stitches. Do not knit the marker in.`, { tech: ['markers'] });
      a.needs.push(`${k} stitch markers (or short loops of contrasting yarn)`);
      a.why.push('These markers show the raglan lines where you add stitches later.');
    },
  },
  {
    name: 'count-and-mark',
    re: /^count \d+ stitches?,? (?:insert|place) .*marker/i,
    run: (_m, a, s) => {
      flatNote(a);
      const parts = [...s.matchAll(/count (\d+) stitches?,? (?:insert|place) (?:a )?marker(?:-?thread)? (\d+)/gi)];
      const left = s.match(/there are (\d+) stitches left/i);
      let cum = 0;
      for (const p of parts) {
        const cnt = Number(p[1]);
        step(a, `Count ${sts(cnt)} from where you are.`);
        cum += cnt;
        step(a, `Place marker ${p[2]} between that stitch and the next (stitch ${cum} | stitch ${cum + 1}).`, { tech: ['markers'] });
      }
      if (left) step(a, `You should have ${left[1]} stitches left after marker ${parts[parts.length - 1]?.[2] ?? ''}. Stop here: do not work the row yet.`);
      const total = cum + (left ? Number(left[1]) : 0);
      a.checkpoint = { expected: total, label: 'markers placed' };
      if (a.ctx.stitches && a.ctx.stitches !== total) a.assumptions.push(`Check: the counts add up to ${total}, but you should have ${a.ctx.stitches} stitches. Recount.`);
      a.next.stitches = a.ctx.stitches ?? total;
    },
  },
  {
    name: 'divide-intro',
    re: /^divide for the body and sleeves as follows:?$/i,
    run: (_m, a) => {
      step(a, 'You are about to separate the body from the sleeves. The next instruction tells you which stitches to keep and which to put on hold.');
      a.why.push('The sleeve stitches wait on a holder while the body is knitted, then you return to them.');
    },
  },
  {
    name: 'divide-sequence',
    re: /^work (?:the )?(?:first )?\d+ stitches \([^)]*\), place the next \d+ stitches/i,
    run: (_m, a, s) => {
      flatNote(a);
      const clauses = splitClauses(s);
      let worked = 0;
      let held = 0;
      let cast = 0;
      for (const c of clauses) {
        const w = c.match(/^work (?:the )?(first|next|last)? ?(\d+) stitches(?: \(([^)]*)\))?$/i);
        const h = c.match(/^place (?:the )?next (\d+) stitches on a thread(?: for the (\w+))?$/i);
        const k = c.match(/^cast on (\d+) stitches(?: \(([^)]*)\))?$/i);
        if (w) {
          const cnt = Number(w[2]);
          worked += cnt;
          step(a, `Work the ${w[1] ?? 'next'} ${cnt} stitches${w[3] ? ` (${w[3]})` : ''} the way you have been working them (stockinette, with the garter bands at the edges).`);
        } else if (h) {
          const cnt = Number(h[1]);
          held += cnt;
          step(a, `Move the next ${cnt} stitches off your working needle onto waste yarn or a stitch holder. Do not knit these stitches.${h[2] ? ` These are your ${h[2]} stitches and you will return to them later.` : ''}`, { tech: ['hold'] });
        } else if (k) {
          const cnt = Number(k[1]);
          cast += cnt;
          step(a, `Cast on ${cnt} new stitches over the gap where the held stitches were${k[2] ? ` (${k[2]})` : ''}. These form the underarm. Then keep working the next stitches.`, { tech: ['cast'] });
        } else {
          step(a, `⚠ GUIDANCE NEEDS REVIEW: "${c}"`, { review: true, original: c });
          a.review = true;
        }
      }
      const body = worked + cast;
      step(a, `You should now have ${body} stitches on your needle for the body, and ${held} stitches on hold (${held / 2} per sleeve).`);
      a.checkpoint = { expected: body, label: 'body stitches after dividing' };
      if (a.ctx.stitches && worked + held !== a.ctx.stitches) {
        a.assumptions.push(`Check: the stitches in this instruction add up to ${worked + held}, but you should have ${a.ctx.stitches} before dividing. Recount before you divide.`);
      }
      a.next.stitches = body;
      a.next.aside = held / 2;
      a.why.push('The body continues on its own; the sleeves wait on holders until you pick them up.');
    },
  },
  {
    name: 'stated-count',
    re: /^= (\d+) stitches\.?$/i,
    run: (m, a) => {
      const k = Number(m[1]);
      step(a, `CHECK: you should now have ${k} stitches.`);
      a.checkpoint = { expected: k, label: 'stitch count' };
      a.next.stitches = k;
    },
  },
  {
    name: 'continue-further',
    re: /^continue with stockinette(?: stitch)?(?: and the bands in garter stitch)? for a further (\d+(?:\.\d+)?[¼½¾]?) cm\.?$/i,
    run: (m, a) => {
      const target = n(m[1]);
      flatNote(a);
      const band = a.ctx.band;
      step(a, 'Keep working back and forth. Turn your work at the end of each row. Do not join in the round.');
      step(a, `Right-side rows: ${band ? `knit the first ${band} and last ${band} stitches` : 'knit the band stitches at both edges'} (garter), knit all stitches between (stockinette).`);
      step(a, `Wrong-side rows: ${band ? `knit the first ${band} and last ${band} stitches` : 'knit the band stitches at both edges'}, purl all stitches between.`);
      step(a, `Continue until the work has grown ${fmtCm(target)} cm since you divided for the sleeves.`, { tech: ['stockinette'] });
      a.measurement = { key: `body-further:${fmtCm(target)}`, target, label: 'body length', from: 'the underarm (where you divided for the sleeves)' };
      a.assumptions.push('"A further" is read as measured from the underarm. If the pattern means something else, check View Original.');
    },
  },
  {
    name: 'increase-evenly-row',
    re: /^knit 1 (row|round) from the (right|wrong) side and increase (\d+) stitches evenly spaced(?: \(([^)]*)\))? = (\d+) stitches\.?$/i,
    run: (m, a) => evenly(a, Number(m[3]), Number(m[5]), /row/i.test(m[1]), /do not increase over the bands/i.test(m[4] ?? '')),
  },
  {
    name: 'increase-evenly-round',
    re: /^knit 1 round and increase (\d+) stitches evenly spaced = (\d+) stitches\.?$/i,
    run: (m, a) => evenly(a, Number(m[1]), Number(m[2]), false, false),
  },
  {
    name: 'change-needle-rib-explicit',
    re: /^change to circular needle size (\d+(?:\.\d+)?) mm and work as follows from the (wrong|right) side: (.+)$/i,
    run: (m, a, s) => {
      const body = m[3];
      const band = body.match(/(\d+) band stitches/i);
      const until = body.match(/until there are (\d+) stitches left/i);
      flatNote(a);
      a.needs.push(`${fmtCm(Number(m[1]))} mm circular needle`);
      step(a, `Change to your ${fmtCm(Number(m[1]))} mm circular needle (a smaller needle than before). You are still working back and forth.`);
      if (band && until && /purl 1,? knit 1/i.test(body)) {
        const b = Number(band[1]);
        step(a, `${SIDE(m[2])} row: knit the first ${sts(b)} (garter band).`);
        step(a, `Then repeat: purl 1, knit 1, until ${sts(Number(until[1]))} remain.`, { tech: ['rib'] });
        step(a, `Purl 1, then knit the last ${sts(b)} (garter band).`);
        a.why.push('Ribbing on a smaller needle makes a snug edge that does not flare.');
        a.next.lastSide = /wrong/i.test(m[2]) ? 'WS' : 'RS';
      } else {
        step(a, `⚠ GUIDANCE NEEDS REVIEW: "${s}"`, { review: true, original: s });
        a.review = true;
      }
    },
  },
  {
    name: 'continue-rib',
    re: /^continue this rib for (\d+(?:\.\d+)?) cm\.?$/i,
    run: (m, a) => {
      const target = n(m[1]);
      const band = a.ctx.band;
      flatNote(a);
      step(a, 'Turn your work.', { tech: ['turn'] });
      step(a, `Next row: ${band ? `knit the first ${sts(band)}` : 'knit the band stitches'} (garter band), then knit the knit stitches and purl the purl stitches as they face you, and knit the last ${band ? sts(band) : 'band stitches'}.`, { tech: ['rib'] });
      step(a, `Keep going like this, row after row, until the rib measures ${fmtCm(target)} cm.`);
      a.measurement = { key: `rib:${fmtCm(target)}`, target, label: 'rib length', from: 'where the rib started' };
    },
  },
  {
    name: 'place-sleeve-pickup',
    re: /^place the (\d+) stitches from the thread on (?:a )?(.*?)(?: size)? (\d+(?:\.\d+)?) mm and knit up 1 stitch in each of the (\d+) stitches cast on under the sleeve = (\d+) stitches\.?$/i,
    run: (m, a, s) => {
      const held = Number(m[1]);
      const under = Number(m[4]);
      const total = Number(m[5]);
      roundNote(a);
      a.ctx.construction = 'round';
      a.needs.push(a.ctx.prefs.smallCircumference === 'dpn' ? `${m[3]} mm double-pointed needles` : `${m[3]} mm circular needle, 80 cm or longer (for Magic Loop)`);
      step(a, `Move the ${held} held sleeve stitches from the waste yarn back onto your ${m[3]} mm circular needle.`, { tech: ['hold'] });
      magicLoop(a);
      step(a, `Find the ${under} stitches you cast on under the arm. Join your yarn at the underarm.`);
      step(a, `Pick up and knit 1 stitch in each of those ${under} cast-on stitches: put the needle into the loop of each cast-on stitch, wrap the yarn and pull a loop through.`, { tech: ['pickup'] });
      step(a, `You are now working IN THE ROUND. You should have ${total} stitches (${held} + ${under}).`);
      a.checkpoint = { expected: total, label: 'sleeve stitches' };
      a.next.stitches = total;
      a.why.push('The sleeve is worked as a tube from the underarm down to the cuff.');
      if (held + under !== total) a.assumptions.push(`Check: ${held} + ${under} is not ${total}.`);
      void s;
    },
  },
  {
    name: 'marker-middle-underarm',
    re: /^insert a marker-?thread in the middle of the new stitches under the sleeve\.?$/i,
    run: (_m, a) => {
      const k = a.ctx.lastCastOn;
      step(a, k ? `Place a marker in the middle of the ${k} new underarm stitches (after ${k / 2} of them).` : 'Place a marker in the middle of the new underarm stitches.', { tech: ['markers'] });
      a.why.push('This marker shows the middle of the underarm, where the sleeve decreases are made. It also marks the start of each round.');
    },
  },
  {
    name: 'in-the-round',
    re: /^work stockinette stitch in the round\.?$/i,
    run: (_m, a) => {
      roundNote(a);
      step(a, 'Knit every round. Do not turn your work.', { tech: ['stockinette'] });
      a.why.push('Stockinette in the round is just knit, knit, knit: there are no purl rows.');
    },
  },
  {
    name: 'decrease-tip',
    re: /^(?:start|begin) (\d+) stitches before the marker-?thread,?:? knit 2 together, knit 2 \([^)]*\), slip 1 stitch knit-?wise, knit 1 and pass the slipped stitch over the knitted stitch/i,
    run: (m, a) => {
      const k = Number(m[1]);
      step(a, `Knit until ${sts(k)} remain before the underarm marker.`);
      step(a, 'Knit 2 stitches together (k2tog).', { tech: ['k2tog'] });
      step(a, 'Knit 2. The marker sits between these 2 stitches.');
      step(a, 'Slip 1 stitch knitwise.', { tech: ['slip'] });
      step(a, 'Knit 1.');
      step(a, 'Pass the slipped stitch over the stitch you just knitted (psso).', { tech: ['psso'] });
      step(a, 'You have decreased 2 stitches.');
      a.why.push('The two decreases lean toward each other and narrow the sleeve neatly under the arm.');
    },
  },
  {
    name: 'rib-sleeve-cuff',
    re: /^change to (?:double pointed needles|circular needles?|dpn)[^.]*? size (\d+(?:\.\d+)?) mm and work rib \(knit (\d+), purl (\d+)\) for (\d+(?:\.\d+)?) cm\.?$/i,
    run: (m, a) => {
      const target = n(m[4]);
      roundNote(a);
      a.ctx.construction = 'round';
      a.needs.push(a.ctx.prefs.smallCircumference === 'dpn' ? `${m[1]} mm double-pointed needles` : `${m[1]} mm circular needle, 80 cm or longer (for Magic Loop)`);
      step(a, `Change to your ${m[1]} mm needle (smaller than before).`);
      magicLoop(a);
      step(a, `Work in the round: knit ${m[2]}, purl ${m[3]}, repeat to the end of every round. Do not turn.`, { tech: ['rib'] });
      step(a, `Continue until the cuff rib measures ${fmtCm(target)} cm.`);
      a.measurement = { key: `cuff:${fmtCm(target)}`, target, label: 'cuff rib length', from: 'where the rib started' };
      a.why.push('Ribbing is stretchy, so the cuff hugs your wrist.');
    },
  },
  {
    name: 'bind-off',
    re: /^(?:bind|cast) off\.?$/i,
    run: (_m, a) => {
      step(a, 'Bind off all stitches loosely.', { tech: ['bindoff'] });
      a.why.push('Binding off locks the stitches so the edge cannot unravel.');
    },
  },
  {
    name: 'other-sleeve',
    re: /^work the other sleeve in the same way\.?$/i,
    run: (_m, a) => {
      step(a, 'Repeat all of the sleeve steps for the second sleeve, starting by moving its held stitches back onto your needle.');
    },
  },
  {
    name: 'assembly-buttons',
    re: /^sew the buttons onto the left band\.?$/i,
    run: (_m, a) => {
      step(a, 'Sew the buttons onto the left band, each one lined up with a buttonhole on the right band.');
    },
  },
  {
    name: 'assembly-bands',
    re: /^sew together the 2 loose bands mid-back and sew them to the neckline\.?$/i,
    run: (_m, a) => {
      step(a, 'The two front bands have loose ends at the back of the neck. Sew those two ends together at the centre back.');
      step(a, 'Then sew the joined band along the back-neck edge.');
    },
  },
  {
    name: 'continue-until-measures',
    re: /^continue (?:working )?(?:in pattern |as before )?until the (\w+) measures (\d+(?:\.\d+)?[¼½¾]?) cm(?: = [^.]*?)?(?: from (?:the )?(.+?))?\.?$/i,
    run: (m, a) => {
      const from = m[3] ? ` Measure from ${m[3].replace(/\s*=.*$/, '')}.` : '';
      step(a, `Keep working as you have been until the ${m[1]} measures ${fmtCm(n(m[2]))} cm.${from} Measure the piece laid flat, without stretching it.`);
      a.measurement = { key: `until:${a.ctx.sectionTitle}:${fmtCm(n(m[2]))}`, target: n(m[2]), label: `${m[1]} length`, from: m[3] ? m[3].replace(/\s*=.*$/, '') : 'where you started this part' };
      a.why.push('The pattern is measurement-based, so the app cannot know the row count for you. Use MEASUREMENT CHECK.');
    },
  },
  {
    name: 'knit-rows',
    re: /^(?:work|knit) (\d+) (rows?|rounds?)(?: (?:in )?(?:garter|stockinette) stitch)?\.?$/i,
    run: (m, a) => {
      const k = Number(m[1]);
      const round = /round/i.test(m[2]);
      if (round) roundNote(a);
      else if (!a.construction) flatNote(a);
      step(a, `Knit every stitch for ${k} ${k === 1 ? m[2].replace(/s$/i, '') : m[2].replace(/s?$/i, 's')}.${round ? '' : ' Turn your work at the end of each row.'}`, { tech: ['knit'] });
      if (!round) a.why.push('Knitting every row gives garter stitch: a ridged, flat fabric.');
    },
  },
  {
    name: 'rib-rows',
    re: /^work (\d+) (rows?|rounds?) (?:of|in) 1x1 rib(?:bing)?\.?$/i,
    run: (m, a) => {
      const round = /round/i.test(m[2]);
      if (round) roundNote(a);
      else flatNote(a);
      step(a, `Work ${m[1]} ${m[2]} of 1x1 rib: knit 1, purl 1 across ${round ? 'every round' : 'every row'}${round ? '.' : ', turning at the end of each row.'}`, { tech: ['rib'] });
    },
  },
  {
    name: 'know-all-rows',
    re: /^(?:k|knit) all rows\.?$/i,
    run: (_m, a) => {
      flatNote(a);
      step(a, 'Knit every stitch of every row.', { tech: ['garter'] });
    },
  },
];

/** Split "a, b (c, d), e" into clauses at top-level commas. */
function splitClauses(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s.replace(/\.$/, '')) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Evenly spaced increases: spacing is CALCULATED by Knit Guide and labelled so. */
function evenly(a: Acc, count: number, total: number, flat: boolean, excludeBands: boolean) {
  const band = excludeBands ? a.ctx.band ?? 0 : 0;
  const before = a.ctx.stitches ?? total - count;
  const eligible = before - 2 * band;
  if (flat) flatNote(a);
  else roundNote(a);
  if (eligible <= 0 || count <= 0) {
    step(a, `⚠ GUIDANCE NEEDS REVIEW: cannot work out the spacing for ${count} increases.`, { review: true });
    a.review = true;
    return;
  }
  const gaps: number[] = [];
  let acc = 0;
  for (let i = 1; i <= count; i++) {
    const pos = Math.round((i * eligible) / (count + 1));
    gaps.push(pos - acc);
    acc = pos;
  }
  const runs: [number, number][] = [];
  for (const g of gaps) {
    const last = runs[runs.length - 1];
    if (last && last[0] === g) last[1]++;
    else runs.push([g, 1]);
  }
  if (flat) step(a, 'Turn your work if you need to, so the right side faces you.');
  if (band) step(a, `Work the first ${sts(band)} (garter band) without increasing.`);
  step(a, `Now increase ${count} stitches evenly across the next ${eligible} stitches. The pattern does not say which increase to use: a make-1 (M1L) or a yarn over worked twisted next row are both fine.`, { tech: ['increase', 'evenly'] });
  step(a, `Spacing (calculated by Knit Guide, about every ${Math.round(eligible / count)}th stitch): ${runs.map(([g, c]) => `${c} × (knit ${g}, increase 1)`).join(', then ')}, then knit to the end of this section.`);
  if (band) step(a, `Work the last ${sts(band)} (garter band) without increasing.`);
  step(a, `You should now have ${total} stitches.`);
  a.checkpoint = { expected: total, label: 'after evenly spaced increases' };
  a.next.stitches = total;
  a.assumptions.push('Increase method not stated in the pattern: you choose. The spacing is calculated by Knit Guide.');
  a.why.push('Spreading the increases evenly makes the fabric grow smoothly instead of flaring in one place.');
}

/* ------------------------------------------------------- general vocabulary */

const NOTE_START =
  /^(?:note\b|you (?:may|can|will|should)|this is\b|these\b|the (?:\d+ |central )?[a-z ]*(?:markers?|sts|stitches) (?:separate|are|is)|while (?:working|short)|to work\b|throughout the\b|keep (?:the )?bor marker|sleeve sts are placed|on the (?:following|separation) round|select one of|the simpler|an alternative|working the|optional\b|we (?:use|prefer)|for help\b|tip\b|share your\b|we love\b|they\b|double the stitch on|pass the yarn over the needle|bring the yarn between|with yarn on the|this .doubled)/i;

const HEAD =
  /^((?:[A-Za-z-]+ ){0,2}(?:rows?|rounds?|rnds?)(?: \d+)?(?: ?\([^)]*\))?|marker set-?up|set-?up(?: round| row)?|shift bor|separation round|neckline increase round)\s*:\s*(.+)$/i;

interface Def {
  kind: 'round' | 'even';
  label: string;
  n?: number;
  steps: TStep[];
  delta?: number;
  count?: number;
}

const mkStep = (text: string, tech: string[] = techniquesIn(text), extra: Partial<TStep> = {}): TStep => ({ text, tech, ...extra });
const fromOp = (st: { text: string; tech: string[]; note?: boolean }): TStep => mkStep(st.text, st.tech, st.note ? { note: true } : {});

interface Work {
  pending: Def[];
  parts: TPart[];
  partStart: number;
  lastRepeat?: RepeatBlock;
}

function setStitches(a: Acc, k: number | undefined) {
  if (k === undefined || Number.isNaN(k)) return;
  a.next.stitches = k;
  a.ctx.stitches = k;
}

function applyCounts(a: Acc, r: { delta: number; deltaKnown: boolean; statedTotal?: number; statedChange?: number; startAt?: number; endsEmpty?: boolean }, label: string, w?: Work, checkOnly = false) {
  const before = r.startAt ?? a.ctx.stitches;
  if (checkOnly) {
    if (r.statedChange !== undefined && r.deltaKnown && r.statedChange !== r.delta) a.assumptions.push(`Check ${label}: the steps change ${r.delta >= 0 ? '+' : ''}${r.delta} stitches, but the pattern says ${r.statedChange >= 0 ? '+' : ''}${r.statedChange}.`);
    return;
  }
  if (r.statedTotal !== undefined) {
    a.checkpoint = { expected: r.statedTotal, label: 'count given by the pattern' };
    if (before !== undefined && r.deltaKnown && before + r.delta !== r.statedTotal) {
      a.assumptions.push(`Check ${label}: ${before} ${r.delta >= 0 ? '+' : '−'} ${Math.abs(r.delta)} is ${before + r.delta}, but the pattern says ${r.statedTotal}. Recount and trust the pattern.`);
    }
    setStitches(a, r.statedTotal);
    if (w?.lastRepeat) w.lastRepeat.statedAfter = r.statedTotal;
  } else if (r.endsEmpty) {
    a.next.stitches = undefined;
    a.ctx.stitches = undefined;
  } else if (r.deltaKnown && before !== undefined && (r.delta !== 0 || r.startAt !== undefined)) {
    setStitches(a, before + r.delta);
  }
  if (r.statedChange !== undefined && r.deltaKnown && r.statedChange !== r.delta) {
    a.assumptions.push(`Check ${label}: the steps change ${r.delta >= 0 ? '+' : ''}${r.delta} stitches, but the pattern says ${r.statedChange >= 0 ? '+' : ''}${r.statedChange}.`);
  }
}

/** A sequence of stitch operations ("k2, yo, ssk") as physical steps. Returns false if any part is unknown. */
function sequenceSteps(body: string, a: Acc, w: Work, head?: string): boolean {
  const { body: core, total, change } = stripNotes(body.replace(/\.$/, ''));
  const r = interpretSequence(core);
  if (!r) return false;
  flush(a, w);
  if (head) a.steps.push(mkStep(`${head}:`, [], { note: true }));
  for (const st of r.steps) a.steps.push(fromOp(st));
  if (r.joinRound) roundNote(a);
  else if (r.turns > 0 && !a.construction) flatNote(a);
  applyCounts(a, { ...r, statedTotal: total ?? r.statedTotal, statedChange: change ?? r.statedChange }, head ?? 'this step', w);
  return true;
}

/** Emit rounds that were being collected and turned out not to be part of a repeat. */
function flush(a: Acc, w: Work) {
  for (const d of w.pending) emitDef(a, d);
  w.pending = [];
}

function emitDef(a: Acc, d: Def) {
  if (d.kind === 'even') {
    a.steps.push(mkStep(`Work ${d.count} ${d.label}${d.count === 1 ? '' : 's'} even: keep working in pattern, no shaping.`, []));
    return;
  }
  a.steps.push(mkStep(`${d.label}:`, [], { note: true }));
  a.steps.push(...d.steps);
  const before = a.ctx.stitches;
  if (d.delta !== undefined && before !== undefined && d.delta !== 0) setStitches(a, before + d.delta);
}

function consumeRepeat(a: Acc, w: Work, unit: 'round' | 'row', times: number | undefined, from?: number, to?: number, statedRounds?: number, until?: RepeatBlock['until']): boolean {
  let take = w.pending;
  let keepBefore: Def[] = [];
  let keepAfter: Def[] = [];
  if (from !== undefined && to !== undefined) {
    const idxs = w.pending.map((d, i) => (d.kind === 'round' && d.n !== undefined && d.n >= from && d.n <= to ? i : -1)).filter((i) => i >= 0);
    if (!idxs.length) return false;
    keepBefore = w.pending.slice(0, idxs[0]);
    take = w.pending.slice(idxs[0], idxs[idxs.length - 1] + 1);
    keepAfter = w.pending.slice(idxs[idxs.length - 1] + 1);
  }
  if (!take.length) return false;
  const rounds: RepeatRound[] = [];
  for (const d of take) {
    if (d.kind === 'even') for (let i = 0; i < (d.count ?? 0); i++) rounds.push({ label: `Plain ${unit}`, steps: [mkStep(`Work this ${unit} in pattern with no shaping: knit the knits, purl the purls, keep any garter panels as set.`, [])], delta: 0 });
    else rounds.push({ label: d.label, steps: d.steps, delta: d.delta });
  }
  if (times !== undefined && statedRounds !== undefined && statedRounds !== rounds.length * times && statedRounds !== rounds.length) {
    a.assumptions.push(`The pattern says ${statedRounds} ${unit}s in all, but ${rounds.length} ${unit}${rounds.length === 1 ? '' : 's'} × ${times} is ${rounds.length * times}. Check View Original.`);
  }
  // earlier rounds that are not in the repeat are worked once, first
  w.pending = keepBefore;
  flush(a, w);
  if (a.steps.length > w.partStart) w.parts.push({ kind: 'steps', steps: a.steps.slice(w.partStart) });
  const block: RepeatBlock = { unit, rounds, times, until, before: a.ctx.stitches };
  w.parts.push({ kind: 'repeat', block });
  w.lastRepeat = block;
  w.partStart = a.steps.length;
  const allKnown = rounds.every((r) => r.delta !== undefined);
  if (allKnown && a.ctx.stitches !== undefined) {
    const perRepeat = rounds.reduce((n, r) => n + (r.delta ?? 0), 0);
    if (times !== undefined) setStitches(a, a.ctx.stitches + perRepeat * times);
    else if (perRepeat === 0) setStitches(a, a.ctx.stitches);
  }
  if (until) a.measurement = { key: `rep-until:${a.ctx.sectionTitle}:${until.what}:${fmtCm(until.cm)}`, target: until.cm, label: `${until.what} length`, from: until.from ?? 'the cast-on edge (lay it flat, do not stretch it)' };
  w.pending = keepAfter;
  return true;
}

const GENERIC: Rec[] = [
  {
    name: 'cast-on-general',
    re: /^(?:(?:using|with|on) (.+?),?\s+)?(provisional )?cast on (\d+)(?: sts| stitches)?(?: \(([^)]*)\))?(?:[,\s]+(.*))?$/i,
    run: (m, a) => {
      const k = Number(m[3]);
      const prov = !!m[2];
      const note = m[4];
      const rest = m[5] ?? '';
      let tail = rest;
      let method: string | undefined;
      let needleText = m[1];
      let yarn: string | undefined;
      const first = rest.split(/,\s*/)[0] ?? '';
      const mm = first.match(/^(?:using|with) (?:the )?(.+?(?: method| cast-on))$/i);
      if (mm) {
        method = mm[1];
        tail = rest.slice(first.length).replace(/^,\s*/, '');
      } else if (/^(?:on|onto) /i.test(first) || /needles?\b/i.test(first)) {
        needleText = first.replace(/^(?:on|onto) /i, '');
        tail = rest.slice(first.length).replace(/^,\s*/, '');
      }
      if (needleText) {
        const ym = needleText.match(/\s+with\s+(.+)$/i);
        if (ym) {
          yarn = ym[1];
          needleText = needleText.replace(/\s+with\s+.+$/i, '');
        }
        const nd = needleFrom(needleText);
        if (nd.mm) needleNeeds(a, needleText, false);
        else if (/needle/i.test(needleText)) step(a, `Pick up your ${needleText.replace(/^(?:the |a )/i, '')}.`);
      }
      if (yarn) a.needs.push(`Yarn: ${yarn}`);
      step(a, prov ? `Cast on ${sts(k)} using a provisional cast-on.` : `Cast on ${sts(k)}${method ? ` using the ${method}` : ''}${note ? ` (${note})` : ''}.`, { tech: prov ? ['provisional', 'cast'] : ['cast'] });
      setStitches(a, k);
      a.next.lastCastOn = k;
      a.checkpoint = { expected: k, label: 'cast-on' };
      if (tail) {
        const r = interpretSequence(tail);
        if (r) {
          for (const st of r.steps) a.steps.push(fromOp(st));
          if (r.joinRound) roundNote(a);
        } else {
          step(a, `⚠ GUIDANCE NEEDS REVIEW: "${tail}"`, { review: true, original: tail });
          a.review = true;
        }
      }
      a.why.push('This is the starting edge of the piece.');
    },
  },
  {
    name: 'worked-how',
    re: /^worked (back and forth|flat|in the round|in rows|from the top down|from the bottom up)(?: on (?:a |the )?(?:circular |straight |double[- ]pointed )?needles?)?(?:,? (?:from|starting at|beginning at) (.+))?$/i,
    run: (m, a, s) => {
      if (/back and forth|flat|in rows/i.test(m[1])) flatNote(a);
      else if (/round/i.test(m[1])) roundNote(a);
      step(a, `${s.endsWith('.') ? s : `${s}.`}`, { note: true });
    },
  },
  {
    name: 'join-round',
    re: /^(?:then )?(?:place (?:a )?(?:bor |beginning[- ]of[- ]round )?marker(?: and|,) ?)?join(?: for| to)?(?: working| work)? in the round(?:,? (?:being careful )?(?:not to|to avoid) twist(?:ing)?(?: the (?:stitches|sts))?)?$/i,
    run: (_m, a) => {
      step(a, 'Place a marker on the right needle to mark the beginning of the round.', { tech: ['markers'] });
      step(a, 'Join in the round: bring the last stitch next to the first without twisting the stitches, then start knitting round and round.', { tech: ['join'] });
      roundNote(a);
    },
  },
  {
    name: 'needle-change',
    re: /^(?:after casting on,? )?(?:switch|change) to (?:the |your )?(larger|smaller|bigger)?(?: circular| double[- ]pointed| dpn)? ?needles?(?: size ([\d.]+) mm)?(?:,? (?:and|then) (.+)|,\s*(.+))?$/i,
    run: (m, a) => {
      const which = m[1] ? ` (${m[1].toLowerCase() === 'smaller' ? 'the smaller ones, usually used for ribbing' : 'the larger ones used for the body'})` : '';
      step(a, `Change to your ${m[1] ? `${m[1].toLowerCase()} ` : ''}${m[2] ? `${fmtCm(Number(m[2]))} mm ` : ''}needles${which}.`);
      if (m[2]) a.needs.push(`${fmtCm(Number(m[2]))} mm needles`);
      const rest = m[3] ?? m[4];
      if (rest) handleRest(a, rest);
    },
  },
  {
    name: 'rib-for',
    re: /^(?:after casting on,? )?work in (?:(\d)x(\d)|k(\d),? ?p(\d)) (?:\(k\d,? ?p\d\) )?rib(?:bing)?(?: \(k\d,? ?p\d\))?(?: for (\d+(?:\.\d+)?) (cm|rounds?|rows?))?$/i,
    run: (m, a) => {
      const kk = m[1] ?? m[3];
      const pp = m[2] ?? m[4];
      const round = (a.ctx.construction ?? a.construction) === 'round';
      const size = m[5] ? Number(m[5]) : undefined;
      if (round) step(a, `Work in ${kk}x${pp} rib in the round: knit ${kk}, purl ${pp}, and repeat to the end of every round. Do not turn your work.`, { tech: ['rib'] });
      else step(a, `Work in ${kk}x${pp} rib: knit ${kk}, purl ${pp} across the row, then turn. On the next row knit the knits and purl the purls as they face you.`, { tech: ['rib'] });
      if (size !== undefined && m[6].toLowerCase() === 'cm') {
        step(a, `Keep going, round after round, until the rib measures ${fmtCm(size)} cm.`.replace('round after round', round ? 'round after round' : 'row after row'));
        a.measurement = { key: `rib:${a.ctx.sectionTitle}:${fmtCm(size)}`, target: size, label: 'rib length', from: 'the cast-on edge (lay it flat, do not stretch it)' };
      } else if (size !== undefined) {
        step(a, `Work ${size} ${m[6].toLowerCase()} in all. Tick them off as you go.`);
      }
      a.why.push('Ribbing is stretchy and pulls in, so the edge hugs the body.');
    },
  },
  {
    name: 'increase-evenly-general',
    re: /^(?:(?:knit|work) )?(?:increasing|increase) (\d+) (?:sts|stitches)(?: evenly)?(?: spaced)?(?: (?:across|around))?(?: the (?:row|round))?$/i,
    run: (m, a, s) => {
      void s;
      const count = Number(m[1]);
      const flat = (a.ctx.construction ?? a.construction) !== 'round';
      const total = a.ctx.stitches !== undefined ? a.ctx.stitches + count : 0;
      if (!a.ctx.stitches) {
        step(a, `Increase ${count} stitches evenly spaced across the round (about every ${'few'} stitches). The pattern does not say which increase to use: a make-1 (M1L) or kfb are both fine.`, { tech: ['increase', 'evenly'] });
        return;
      }
      evenly(a, count, total, flat, false);
    },
  },
  {
    name: 'stated-count-only',
    re: /^\[(\d+) (?:[a-z]+ )?(?:sts|stitches)\b(?:,\s*)?([^\]]*)\]\.?$/i,
    run: (m, a) => {
      const k = Number(m[1]);
      step(a, `CHECK: you should have ${k} stitches in total.`);
      for (const part of (m[2] ?? '').split(/,\s*/).filter(Boolean)) step(a, `CHECK: ${part.replace(/\bsts\b/, 'stitches')}.`);
      a.checkpoint = { expected: k, label: 'count given by the pattern' };
      setStitches(a, k);
    },
  },
  {
    name: 'work-until-measures',
    re: /^(?:work|knit|continue)(?: even| in pattern| straight| in stockinette(?: stitch)?| in garter(?: stitch)?)?\s*(?:\([^)]*\)\s*)?until (?:the )?([a-z ]+?) measures (?:at least )?(\d+(?:\.\d+)?) cm(?: deep| long)?(?:,? (?:measured )?(?:from|at) (.+?))?(?:,? or (\d+(?:\.\d+)?) cm short of (?:the )?desired length)?$/i,
    run: (m, a) => {
      const what = m[1].trim();
      const target = Number(m[2]);
      step(a, `Keep working in pattern with no more shaping, round after round (or row after row), until the ${what} measures ${fmtCm(target)} cm.`);
      if (m[4]) step(a, `Or, if you want a different length: stop ${fmtCm(Number(m[4]))} cm short of the length you want, then add the ribbing.`);
      step(a, 'Lay the piece flat and measure it without stretching.');
      a.measurement = { key: `until:${a.ctx.sectionTitle}:${what}:${fmtCm(target)}`, target, label: `${what} length`, from: m[3] ? m[3].replace(/,.*$/, '') : 'where you started this part' };
      a.why.push('The pattern is measurement-based, so the app cannot know the row count for you. Use MEASUREMENT CHECK.');
    },
  },
  {
    name: 'work-until-options',
    re: /^work (?:even|in pattern|in stockinette(?: stitch)?|in garter(?: stitch)?)?\s*until (?:the )?([a-z ]+?) measures:?$/i,
    run: (m, a) => {
      step(a, `Keep working until the ${m[1].trim()} reaches the length you choose from the options that follow.`);
    },
  },
  {
    name: 'work-length',
    re: /^work (\d+(?:\.\d+)?) cm(?: even| in pattern| straight)?$/i,
    run: (m, a) => {
      const target = Number(m[1]);
      step(a, `Keep working in pattern until this part has grown ${fmtCm(target)} cm from where it started.`);
      step(a, 'Lay the piece flat and measure it without stretching.');
      a.measurement = { key: `grow:${a.ctx.sectionTitle}:${fmtCm(target)}:${a.ctx.stitches ?? ''}`, target, label: 'length of this part', from: 'where this part started' };
    },
  },

  {
    name: 'length-option',
    re: /^([A-Za-z ]+?) lengths?:\s*(\d+(?:\.\d+)?) cm(?: from (.+?))?(?:,? or (\d+(?:\.\d+)?) cm short of (?:the )?desired length)?$/i,
    run: (m, a) => {
      const target = Number(m[2]);
      step(a, `If you are knitting the ${m[1].toLowerCase()} length: work until the piece measures ${fmtCm(target)} cm${m[3] ? ` from ${m[3]}` : ''}.`);
      if (m[4]) step(a, `Or stop ${fmtCm(Number(m[4]))} cm short of the length you want, then add the ribbing.`);
      a.measurement = { key: `len-opt:${a.ctx.sectionTitle}:${m[1]}:${fmtCm(target)}`, target, label: `${m[1].toLowerCase()} length`, from: m[3] ?? 'where this part started' };
      a.why.push('Choose ONE length option. The pattern gives a measurement, not a number of rows.');
    },
  },
  {
    name: 'labelled-sentence',
    re: /^((?:[A-Za-z]+ ){0,4}(?:lengths?|options?|methods?)):\s+(.+)$/i,
    run: (m, a) => {
      step(a, `For: ${m[1]}.`, { note: true });
      handleRest(a, m[2]);
    },
  },

  {
    name: 'weave-in',
    re: /^weave in (?:all |the )?(?:yarn )?(?:ends|tails)\b.*$/i,
    run: (_m, a, s) => {
      step(a, 'Weave in all the loose yarn ends: thread each one onto a darning needle and run it through the back of the stitches for a few centimetres, then trim.');
      const sew = s.match(/sew up (.+?)(?:,| then| and block|$)/i);
      if (sew) step(a, `Use the yarn tails to sew up ${sew[1]}.`);
      if (/block/i.test(s)) step(a, 'Block the finished piece: wet it (or steam it), shape it to the measurements, and leave it flat to dry.');
    },
  },
  {
    name: 'block',
    re: /^(?:wet |steam |spray )?block\b.*$/i,
    run: (_m, a) => {
      step(a, 'Block the finished piece: wet it (or steam it), shape it to the measurements, and leave it flat to dry.');
    },
  },
  {
    name: 'close-top',
    re: /^(?:cut|break) (?:the )?yarn(?:,? leaving (?:a )?(?:long |15 cm |20 cm )?tail[^,]*)?,? (?:and )?thread (?:it )?through (?:the )?(?:remaining |all |live )?(?:stitches|sts)(?:,? (?:and )?pull tight)?(?:,? (?:and )?fasten off)?$/i,
    run: (_m, a) => {
      step(a, 'Cut the yarn, leaving a tail about 20 cm long.');
      step(a, 'Thread the tail onto a darning needle and pass it through all the stitches left on your needle, slipping each one off as you go.');
      step(a, 'Pull the tail tight to close the hole, then fasten it off on the inside.');
    },
  },
  {
    name: 'fasten-off',
    re: /^(?:cut|break) (?:the )?yarn(?:,? leaving (?:a )?(?:long |[\d.]+ cm )?tail[^,]*)?(?:,? (?:and )?(?:fasten off|pull (?:it )?through(?: the last (?:stitch|loop))?))?$|^fasten off\b.*$/i,
    run: (_m, a) => {
      step(a, 'Cut the yarn, leaving a tail long enough to weave in later (about 15 cm).');
      step(a, 'Pull the tail through the last loop on the needle and tighten it to fasten off.');
    },
  },
  {
    name: 'sewing',
    re: /^(?:sew|seam|graft|attach|fasten|embroider|sew on|stitch (?:down|together|up))\b.+$/i,
    run: (_m, a, s) => {
      step(a, s.endsWith('.') ? s : `${s}.`);
    },
  },
  {
    name: 'conditional',
    re: /^if (.+?),\s+(.+)$/i,
    run: (m, a) => {
      step(a, `Only if ${m[1]}:`, { note: true });
      handleRest(a, m[2]);
    },
  },
  {
    name: 'use-needles-to',
    re: /^use (?:the |your )?(smaller|larger|bigger)? ?needles? to (.+)$/i,
    run: (m, a) => {
      step(a, `Use your ${m[1] ? m[1].toLowerCase() + ' ' : ''}needles${m[1] && /smaller/i.test(m[1]) ? ' (the ribbing needles)' : ''}.`);
      handleRest(a, m[2]);
    },
  },
  {
    name: 'proceed',
    re: /^(?:then )?proceed to (.+)$/i,
    run: (m, a) => {
      step(a, `Next you will move on to: ${m[1]}.`, { note: true });
    },
  },
];

/** Used by needle-change to translate what follows "and …". */
function handleRest(a: Acc, rest: string) {
  const w: Work = { pending: [], parts: [], partStart: a.steps.length };
  handleSentence(rest.charAt(0).toUpperCase() + rest.slice(1), a, w);
  flush(a, w);
}

function handleSentence(sentence: string, acc: Acc, w: Work) {
  const orig = sentence.trim();
  const s = orig
    .replace(/\.$/, '')
    .replace(/\s*[–-]\s*see (?:above|below)[^.]*$/i, '')
    .replace(/\bgarter st\b/gi, 'garter stitch')
    .replace(/\bstockinette st\b/gi, 'stockinette stitch')
    .replace(/,? this is (\d+) (?:sts|stitches)$/i, ' [$1 sts]');
  if (/⟦|SIZE VALUE NEEDS REVIEW/.test(s)) {
    flush(acc, w);
    step(acc, '⚠ SIZE VALUE NEEDS REVIEW: choose your value first (see the instruction).', { review: true, original: s });
    acc.review = true;
    return;
  }
  const done = () => {
    Object.assign(acc.ctx, acc.next);
    if (acc.ctx.construction === undefined && acc.construction) acc.ctx.construction = acc.construction;
  };

  // designer-specific, exactly-worded recognizers first
  const rec = RECOGNIZERS.find((r) => r.re.test(s));
  if (rec) {
    flush(acc, w);
    rec.run(s.match(rec.re)!, acc, s);
    done();
    return;
  }

  // repeat statements over collected rounds
  let m = s.match(/^work these (\d+) (rows?|rounds?)(?: in all)? a total of (\d+)(?: times?)?(?:,? this is (\d+) (?:rows?|rounds?))?$/i);
  if (m && consumeRepeat(acc, w, /row/i.test(m[2]) ? 'row' : 'round', Number(m[3]), undefined, undefined, m[4] ? Number(m[4]) : undefined)) return done();
  m = s.match(/^work (?:short )?(rows?|rounds?) (\d+)\s*[-–]\s*(\d+) a total of (\d+)(?: times?)?(?:,? this is (\d+) (?:rows?|rounds?))?$/i);
  if (m && consumeRepeat(acc, w, /row/i.test(m[1]) ? 'row' : 'round', Number(m[4]), Number(m[2]), Number(m[3]), m[5] ? Number(m[5]) : undefined)) return done();

  m = s.match(/^(?:work|repeat) (?:these |the )?(?:short )?(rows?|rounds?) (\d+)\s*[-–]\s*(\d+),? (?:again )?until (?:the )?([a-z ]+?) measures (?:at least )?(\d+(?:\.\d+)?) cm(?: from (.+))?$/i);
  if (m && consumeRepeat(acc, w, /row/i.test(m[1]) ? 'row' : 'round', undefined, Number(m[2]), Number(m[3]), undefined, { cm: Number(m[5]), what: m[4].trim(), from: m[6] })) return done();
  m = s.match(/^repeat these (\d+) (rows?|rounds?) until (?:the )?([a-z ]+?) measures (?:at least )?(\d+(?:\.\d+)?) cm(?: from (.+))?$/i);
  if (m && consumeRepeat(acc, w, /row/i.test(m[2]) ? 'row' : 'round', undefined, undefined, undefined, undefined, { cm: Number(m[4]), what: m[3].trim(), from: m[5] })) return done();

  // plain rounds that may belong to a repeat
  m = s.match(/^work (\d+) (rows?|rounds?) (?:even|in pattern|plain)$/i);
  if (m) {
    w.pending.push({ kind: 'even', label: m[2].toLowerCase().replace(/s$/, ''), count: Number(m[1]), steps: [] });
    return;
  }

  // "Round 1: …", "Decrease round: …" are collected (they may be repeated); other headed sequences run now
  const hm = s.match(HEAD);
  if (hm) {
    const head = hm[1].trim();
    const { body, total, change } = stripNotes(hm[2].replace(/\.$/, ''));
    const r = interpretSequence(body);
    if (r) {
      const numbered = head.match(/^(?:short )?(?:rows?|rounds?|rnds?) (\d+)/i);
      const collectable = !!numbered || /^(?:decrease|increase|plain)\s+(?:rows?|rounds?)$/i.test(head);
      if (collectable) {
        w.pending.push({
          kind: 'round',
          label: head.charAt(0).toUpperCase() + head.slice(1),
          n: numbered ? Number(numbered[1]) : undefined,
          steps: r.steps.map(fromOp),
          delta: r.deltaKnown ? r.delta : undefined,
        });
        if (r.joinRound) roundNote(acc);
        if (change !== undefined) applyCounts(acc, { ...r, statedTotal: undefined, statedChange: change }, head, w, true);
        return;
      }
      flush(acc, w);
      acc.steps.push(mkStep(`${head.charAt(0).toUpperCase() + head.slice(1)}:`, [], { note: true }));
      for (const st of r.steps) acc.steps.push(fromOp(st));
      if (r.joinRound) roundNote(acc);
      else if (r.turns > 0 && !acc.construction) flatNote(acc);
      applyCounts(acc, { ...r, statedTotal: total ?? r.statedTotal, statedChange: change ?? r.statedChange }, head, w);
      return done();
    }
  }

  // general sentences (cast on and join, rib for, needle change, evenly spaced increases, …)
  const { body: gBody, total: gTotal } = stripNotes(s.replace(/\.$/, ''));
  const gen = GENERIC.find((g) => g.re.test(gBody) || g.re.test(s));
  if (gen) {
    flush(acc, w);
    const text = gen.re.test(gBody) ? gBody : s;
    gen.run(text.match(gen.re)!, acc, text);
    if (gTotal !== undefined && gen.name !== 'stated-count-only') {
      acc.checkpoint = { expected: gTotal, label: 'count given by the pattern' };
      if (acc.ctx.stitches !== undefined && acc.next.stitches !== undefined && acc.next.stitches !== gTotal) {
        acc.assumptions.push(`Check: the steps give ${acc.next.stitches} stitches, but the pattern says ${gTotal}. Trust the pattern and recount.`);
      }
      setStitches(acc, gTotal);
    }
    if (gen.name === 'stated-count-only' && w.lastRepeat && w.lastRepeat.statedAfter === undefined) {
      const t = s.match(/^\[(\d+)/);
      if (t) w.lastRepeat.statedAfter = Number(t[1]);
    }
    return done();
  }

  // bare stitch sequences ("k2tog, k1")
  if (sequenceSteps(s, acc, w)) return done();

  // explanations are shown as notes, not as steps
  if (NOTE_START.test(s)) {
    flush(acc, w);
    step(acc, orig, { note: true });
    return;
  }
  if (stitchOpSteps(s, acc)) {
    flush(acc, w);
    return;
  }
  flush(acc, w);
  step(acc, `⚠ GUIDANCE NEEDS REVIEW: the guide could not safely translate this into steps.`, { review: true, original: orig });
  acc.review = true;
}

function stitchOpSteps(s: string, a: Acc): boolean {
  const ex = explain(s.replace(/^(?:set-?up |next )?(?:rows?|rounds?)[^:]*:\s*/i, ''), [], []);
  if (!ex.steps.length || ex.untranslated.length) return false;
  const head = s.match(/^((?:set-?up |next )?(?:rows?|rounds?)[^:]{0,30}):/i)?.[1];
  if (head) step(a, `${head}:`);
  for (const t of ex.steps) step(a, t);
  return true;
}

/* ------------------------------------------------------------------ main */

export function translate(text: string, ctx: TCtx): Translation {
  const acc: Acc = {
    ctx: { ...ctx },
    steps: [],
    why: [],
    needs: [],
    next: {},
    assumptions: [],
    review: false,
    held: 0,
    construction: ctx.construction,
  };
  const w: Work = { pending: [], parts: [], partStart: 0 };
  const sentences = text
    .split('\n')
    .flatMap((line) => splitAtSentences(line.replace(/\s+/g, ' ').trim()))
    .flatMap((x) =>
      x
        // a "[124 sts]" note belongs with the sentence before it
        .replace(/([.!?])\s+(?=\[)/g, '$1\u0000')
        // a new capitalised instruction right after "]" starts a new sentence
        .replace(/(\])\s+(?=[A-Z][a-z]+\b)/g, '$1\u0000')
        // rows printed one after another without a full stop: "turn work Short row 2 (WS): …"
        .replace(/(\S)\s+(?=(?:Short row|Row|Round|Rnd) \d+\s*(?:\([^)]*\))?\s*:)/g, '$1\u0000')
        // "… twice The 4 markers …", "… stop While working …", "… measures: Regular length: …"
        .replace(/\b(twice|once|times|stop|measures:|stitch\))\s+(?=(?:The|This|These|While|You|They|Note|We|Regular|Cropped)\b)/g, '$1\u0000')
        .replace(/\b(twice|once)\s+(?=[A-Z][a-z]+ )/g, '$1\u0000')
        .replace(/\b(turn work|even|stop)\s+(?=Work\b)/g, '$1\u0000')
        .split('\u0000'),
    );
  for (const s of sentences) handleSentence(s, acc, w);
  flush(acc, w);
  if (w.parts.length) {
    if (acc.steps.length > w.partStart) w.parts.push({ kind: 'steps', steps: acc.steps.slice(w.partStart) });
  }
  const { ctx: _ctx, held: _held, ...rest } = acc;
  void _ctx;
  void _held;
  return { ...rest, parts: w.parts.length ? w.parts : undefined, construction: acc.construction };
}

/** Header line for flat / round, independent of the needle type. */
export function constructionText(c: Construction | undefined, prefs: KnitPrefs): { title: string; detail: string } | undefined {
  if (c === 'flat') {
    return {
      title: 'WORKING FLAT',
      detail: `Work back and forth. Turn your work at the end of each row. Do not join in the round.${prefs.circular ? ' (You are using a circular needle, but you are still working flat.)' : ''}`,
    };
  }
  if (c === 'round') {
    return { title: 'WORKING IN THE ROUND', detail: 'Do not turn your work. Keep knitting round and round; the start of the round is your marker.' };
  }
  return undefined;
}
