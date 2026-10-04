/**
 * Measurement-driven shaping: "When piece measures 9 cm dec 1 st on each side of both markers and repeat the dec on
 * every 1.5 cm a total of 7 times", "AT THE SAME TIME when piece measures 33 cm …", "Bind off when piece measures 58 cm".
 *
 * Every rule becomes dated events (a length in cm, what to do). All the rules of a section are merged into ONE
 * ordered list, so simultaneous rules never fight for attention. The knitter measures; the app shows what is due
 * and what is next. With the knitter's own swatch it also estimates the row for each length (always an estimate).
 */
import { splitAtSentences } from '../model/text';
import { interpretSequence } from './ops';
import { techniquesIn } from './techniques';
import type { TStep } from './translate';

export interface TEvent {
  id: string;
  cm: number;
  /** short name for lists: "Decrease", "Increase", "Bind off", "Do this" */
  label: string;
  steps: TStep[];
  /** change in stitches when the event is done (known only when the steps are understood) */
  delta?: number;
  /** the steps could not be translated: the designer's words are shown */
  review?: boolean;
  /** which rule it belongs to, for the list ("Decrease every 1.5 cm") */
  rule: string;
  /** the designer's stated stitch count after this event */
  statedAfter?: number;
  /** number of this event within its rule, and how many the rule has */
  nth: number;
  of: number;
}

export interface Timeline {
  events: TEvent[];
  /** stitches on the needle when the first event can happen (undefined when unknown) */
  start?: number;
  /** what the designer says you have at the end, if anything */
  notes: string[];
  /** instructions that were fully used */
  usedIds: string[];
}

const WHEN = /^(?:at the same time,?\s+)?when (?:the |your )?([a-z ]+?) measures (?:at least |about |approx\.? )?(\d+(?:\.\d+)?) cm(?: from [^,]+?)?,?\s*(.*)$/i;
const SUFFIX_WHEN = /^(.+?)\s+when (?:the |your )?([a-z ]+?) measures (?:at least |about |approx\.? )?(\d+(?:\.\d+)?) cm.*$/i;
const REPEAT = /^(.*?),?\s*and repeat (?:the )?(?:dec|inc|decreases?|increases?|[a-z ]+?)? ?on every (\d+(?:\.\d+)?) cm(?: a total of (\d+) times| (\d+) more times)?(?:\s*\(=[^)]*\))?(?:\s*=\s*(\d+) sts?)?$/i;
const STATED = /^(.*?)\s*(?:\(=[^)]*\))?\s*=\s*(\d+) sts?$/i;

const mk = (text: string, extra: Partial<TStep> = {}): TStep => ({ text, tech: techniquesIn(text), ...extra });

function label(action: string): string {
  if (/^(?:dec|decrease)/i.test(action)) return 'Decrease';
  if (/^(?:inc|increase)/i.test(action)) return 'Increase';
  if (/bind off/i.test(action)) return 'Bind off';
  if (/neckline/i.test(action)) return 'Neckline';
  if (/^continue as follows/i.test(action)) return 'New layout';
  return 'Do this';
}

function actionSteps(action: string): { steps: TStep[]; delta?: number; review: boolean } {
  let a = action.replace(/^[,\s]+|[\s.]+$/g, '');
  const head = a.match(/^continue as follows(?: from ([a-z ]+))?:\s*/i);
  if (head) {
    const inner = actionSteps(a.slice(head[0].length));
    return { ...inner, steps: [mk(`New layout${head[1] ? ` (${head[1]})` : ''}:`, { note: true }), ...inner.steps] };
  }
  a = a.replace(/\s*\(=[^)]*\)\s*$/, '');
  const neck = a.match(/^(?:now )?dec(?:rease)? for (?:the )?neckline\b[^:]*:\s*(\d+) sts?$/i);
  if (neck) {
    const n = Number(neck[1]);
    return { steps: [mk(`Decrease ${n} stitch at each neckline edge, inside the front band and the pattern stitches (see the designer's decreasing tip in the original).`)], delta: -2 * n, review: false };
  }
  const band = a.match(/^work (\d+) rows garter st on the (\d+) front band sts on the right side of piece only,? work 1 row on all sts and now work (\d+) rows garter st on the (\d+) front band sts (?:on )?the other side only$/i);
  if (band) {
    return {
      steps: [
        mk(`On the right side of the piece only, knit every stitch of the ${band[2]} front band stitches for ${band[1]} rows; work the other stitches as before.`),
        mk('Work 1 row across all stitches.'),
        mk(`On the other side of the piece only, knit every stitch of the ${band[4]} front band stitches for ${band[3]} rows.`),
      ],
      delta: 0,
      review: false,
    };
  }
  const r = interpretSequence(a);
  if (r && r.steps.length) return { steps: r.steps.map((s) => mk(s.text, { note: s.note })), delta: r.deltaKnown ? r.delta : undefined, review: false };
  return { steps: [mk(`⚠ GUIDANCE NEEDS REVIEW: do this when the length is reached: "${a}"`, { review: true, original: a })], review: true };
}

interface Draft {
  cm: number;
  action: string;
  every?: number;
  times?: number;
  statedAfter?: number;
  extra: string[];
}

const NOTE = /^(?:now )?read all\b|^remember\b|^continue in pattern|^piece measures approx|^this is\b/i;

/** Read one instruction's sentences. Returns null when a sentence does not belong to a timeline. */
function readInstruction(text: string, lastCm: number | undefined, drafts: Draft[], first: boolean): { lastCm?: number; absorbed: string[] } | null {
  const absorbed: string[] = [];
  let cur = lastCm;
  const before = drafts.length;
  const sentences = text
    .split('\n')
    .flatMap((l) => splitAtSentences(l.replace(/\s+/g, ' ').trim()))
    .map((s) => s.replace(/\s*\/\s*["”]\s*/g, ' ').replace(/\.$/, '').trim())
    .filter(Boolean);
  for (const s of sentences) {
    if (NOTE.test(s)) {
      absorbed.push(s);
      continue;
    }
    let m = s.match(WHEN);
    if (m) {
      const cm = Number(m[2]);
      cur = cm;
      for (const part of m[3].split(/,?\s*at the same time,?\s*/i).map((x) => x.trim()).filter(Boolean)) drafts.push(draftFrom(part, cm));
      continue;
    }
    m = s.match(SUFFIX_WHEN);
    if (m) {
      cur = Number(m[3]);
      drafts.push(draftFrom(m[1], cur));
      continue;
    }
    if (first && drafts.length === before) return null;
    if (cur === undefined) return null;
    // "Now dec for neckline … : 1 st on every 1 cm a total of 20 times"
    const ev = s.match(/^(.*?):?\s*(\d+) sts? on every (\d+(?:\.\d+)?) cm a total of (\d+) times$/i);
    if (ev && /dec|inc|bind|neck/i.test(s)) {
      drafts.push({ cm: cur, action: `${ev[1].replace(/:$/, '')}: ${ev[2]} st`, every: Number(ev[3]), times: Number(ev[4]), extra: [] });
      continue;
    }
    // sentences that continue what happens at that length ("Work 1 row on all sts. (to make the neckline neater)")
    if (/^(?:work \d+ rows?|work 1 row|now |then |continue|\(|and )/i.test(s) && drafts.length) {
      drafts[drafts.length - 1].extra.push(s);
      continue;
    }
    return null;
  }
  return { lastCm: cur, absorbed };
}

function draftFrom(part: string, cm: number): Draft {
  let action = part.trim();
  let every: number | undefined;
  let times: number | undefined;
  let stated: number | undefined;
  const r = action.match(REPEAT);
  if (r) {
    action = r[1].replace(/,\s*$/, '');
    every = Number(r[2]);
    times = r[3] ? Number(r[3]) : r[4] ? Number(r[4]) + 1 : undefined;
    if (r[5]) stated = Number(r[5]);
  } else {
    const st = action.match(STATED);
    if (st) {
      action = st[1];
      stated = Number(st[2]);
    }
  }
  return { cm, action, every, times, statedAfter: stated, extra: [] };
}

export function buildTimeline(items: { id: string; text: string }[], startStitches: number | undefined, extra: TEvent[] = []): Timeline | undefined {
  const drafts: Draft[] = [];
  const used: string[] = [];
  const notes: string[] = [];
  let last: number | undefined;
  for (const [i, it] of items.entries()) {
    const r = readInstruction(it.text, last, drafts, i === 0);
    if (!r) break;
    notes.push(...r.absorbed);
    last = r.lastCm;
    used.push(it.id);
  }
  if (!drafts.length) return undefined;

  const events: TEvent[] = [];
  drafts.forEach((d, di) => {
    const a = actionSteps(d.action);
    const times = d.every ? d.times ?? 1 : 1;
    const rule = d.every ? `${label(d.action)} every ${d.every} cm` : `${label(d.action)} at ${d.cm} cm`;
    for (let k = 0; k < times; k++) {
      const steps = [...a.steps];
      for (const x of d.extra) steps.push(mk(x, { note: true }));
      events.push({
        id: `d${di}:${k}`,
        cm: Math.round((d.cm + k * (d.every ?? 0)) * 10) / 10,
        label: label(d.action),
        steps,
        delta: a.delta,
        review: a.review,
        rule,
        statedAfter: k === times - 1 ? d.statedAfter : undefined,
        nth: k + 1,
        of: times,
      });
    }
  });
  events.push(...extra);
  events.sort((x, y) => x.cm - y.cm);
  return { events, start: startStitches, notes, usedIds: used };
}

/** Stitches on the needle after the events in `doneIds`, when every step of every one is understood. */
export function stitchesAfter(t: Timeline, doneIds: string[]): number | undefined {
  if (t.start === undefined) return undefined;
  let n = t.start;
  for (const e of t.events) {
    if (!doneIds.includes(e.id)) continue;
    if (e.delta === undefined) return undefined;
    n += e.delta;
  }
  return n;
}

/**
 * Buttonholes listed as lengths ("Make buttonholes when piece measures: 10, 18, 26 and 34 cm") become events,
 * worded as the designer's own "1 buttonhole = …" line. Returns [] when either piece of wording is missing.
 */
export function buttonholeEvents(items: { id: string; text: string }[]): TEvent[] {
  const how = items.map((i) => i.text.match(/\b1 buttonhole = ([^.]+)/i)).find(Boolean);
  const when = items.map((i) => i.text.match(/^make buttonholes when (?:the )?piece measures:?\s*(.+)$/i)).find(Boolean);
  if (!how || !when) return [];
  const list = when[1].split(/[./]/)[0];
  const cms = [...list.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  if (!cms.length) return [];
  const text = how[1].replace(/\s+/g, ' ').trim();
  const r = interpretSequence(text);
  const steps: TStep[] = r && r.steps.length ? r.steps.map((s) => mk(s.text, { note: s.note })) : [mk(`Buttonhole: ${text}`)];
  return cms.map((cm, i) => ({ id: `bh:${i}`, cm, label: 'Buttonhole', steps, delta: 0, rule: 'Buttonholes at listed lengths', nth: i + 1, of: cms.length }));
}
