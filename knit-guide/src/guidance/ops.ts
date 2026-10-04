/**
 * Stitch-sequence interpreter: "[kfb, knit to 2 sts before marker, kfb, k1, SM] 4 times" becomes
 * ordered physical steps, plus the change in stitch count when it can be worked out.
 *
 * It is a vocabulary, not a pattern: every atom below is ordinary knitting language that appears in
 * garments, blankets, scarves, hats and so on. A sequence is translated only when EVERY atom is
 * understood; otherwise the caller shows the original wording as "needs review" (nothing is guessed).
 */
import { techniquesIn } from './techniques';

export interface OpStep {
  text: string;
  tech: string[];
  note?: boolean;
}

export interface OpResult {
  steps: OpStep[];
  /** change in stitches on the needle (meaningful when deltaKnown) */
  delta: number;
  deltaKnown: boolean;
  /** "[124 sts]" / "[8 sts inc]" printed by the designer after the sequence */
  statedTotal?: number;
  statedChange?: number;
  /** the sequence says to join in the round */
  joinRound?: boolean;
  /** the needle was empty before this sequence and held its own count of stitches after the first step */
  startAt?: number;
  /** every stitch was bound off: the count is no longer known */
  endsEmpty?: boolean;
  /** total of the stitches a row layout covers ("9 garter sts, M.1 on the next 190 sts, 9 garter sts") */
  layoutTotal?: number;
  turns: number;
  markersPlaced: number;
}

interface AtomOut {
  steps: string[];
  note?: boolean;
  /** stitches this part of a row layout covers */
  layout?: number;
  reset?: number;
  empties?: boolean;
  delta?: number;
  join?: boolean;
  turn?: boolean;
  marker?: boolean;
}

const sts = (k: number) => (k === 1 ? '1 stitch' : `${k} stitches`);
const WORD_NUM: Record<string, number> = { once: 1, twice: 2, thrice: 3, 'three times': 3, 'four times': 4, 'five times': 5, 'six times': 6 };

const clean = (t: string) => t.trim().replace(/\s+/g, ' ').replace(/[.;:]+$/, '').replace(/^and\s+/i, '').trim();

/* --------------------------------------------------------------- targets */

function target(raw: string, verb: 'Knit' | 'Purl' | 'Work'): string | null {
  const t = raw.trim().toLowerCase();
  if (/^(?:the )?end(?: of (?:the )?(?:row|round))?$/.test(t)) return `${verb} to the end of the ${/row/.test(t) ? 'row' : 'round'}.`.replace('end of the round', 'end of the row or round');
  let m = t.match(/^(\d+) (?:sts?|stitch(?:es)?) before (?:the )?(.+)$/);
  if (m) return `${verb} until ${sts(Number(m[1]))} remain before ${noun(m[2])}.`;
  m = t.match(/^(?:the )?last (\d+) (?:sts?|stitch(?:es)?)$/);
  if (m) return `${verb} until ${sts(Number(m[1]))} remain.`;
  m = t.match(/^(?:the )?(?:next )?(.+)$/);
  if (m && /marker|\bsm\b|bor|\bcb\b|panel|centre|center|seam|gap|hole|button/.test(m[1])) return `${verb} to ${noun(m[1])}.`;
  return null;
}

function noun(x: string): string {
  const t = x.trim().replace(/\bsts?\b/g, 'stitch');
  if (/^sm$/i.test(t)) return 'the marker';
  if (/^bor( marker)?$/i.test(t)) return 'the beginning-of-round marker';
  if (/^cb( marker)?$/i.test(t)) return 'the centre-back marker';
  return /^(the|a|an)\b/i.test(t) ? t : `the ${t}`;
}

/* ----------------------------------------------------------------- atoms */

function atom(raw: string): AtomOut | null {
  const first = atomCore(raw);
  if (first) return first;
  const pm = clean(raw).match(/^(.*?)\s*\(([^)]*)\)$/);
  if (pm && pm[1]) {
    const inner = atomCore(pm[1]);
    if (inner) return { ...inner, steps: inner.steps.map((x, i) => (i === inner.steps.length - 1 ? `${x.replace(/\.$/, '')} (${pm[2]}).` : x)) };
  }
  return null;
}

function atomCore(raw: string): AtomOut | null {
  const t = clean(raw).toLowerCase().replace(/\bsts?\b/g, 'sts').replace(/\bstitch(?:es)?\b/g, 'sts');
  if (!t) return null;
  let m: RegExpMatchArray | null;

  // knit / purl
  m = t.match(/^(k|p|knit|purl)\s*(\d+)?(?:\s*sts)?(\s*tbl|\s*through the back loops?)?$/);
  if (m) {
    const verb = /^k/.test(m[1]) ? 'Knit' : 'Purl';
    const k = m[2] ? Number(m[2]) : undefined;
    const back = m[3] ? ' through the back loop (this twists the stitch)' : '';
    if (k === undefined && /^(knit|purl)$/.test(m[1])) return { steps: [`${verb} every stitch.`] };
    return { steps: [`${verb} the next ${k === undefined || k === 1 ? 'stitch' : sts(k)}${back}${verb === 'Knit' && !back ? ' normally' : ''}.`] };
  }
  m = t.match(/^(k|p|knit|purl|work)\s+to\s+(.+)$/);
  if (m) {
    const verb = /^k/.test(m[1]) ? 'Knit' : /^p/.test(m[1]) ? 'Purl' : 'Work';
    const s = target(m[2], verb);
    return s ? { steps: [s] } : null;
  }
  m = t.match(/^(?:knit|purl|work) (?:all|every)(?: the)? (?:remaining )?sts(?: to the end)?(?: of the (?:row|round))?$/) ?? t.match(/^(?:knit|purl|work) across$/);
  if (m) return { steps: [`${/^k/.test(t) ? 'Knit' : /^p/.test(t) ? 'Purl' : 'Work'} all the stitches across.`] };

  // increases
  if (/^kfb$/.test(t)) return { steps: ['Knit into the front of the next stitch but do not slip it off. Knit into the back of the same stitch, then slip it off (kfb). 1 stitch became 2.'], delta: 1 };
  if (/^pfb$/.test(t)) return { steps: ['Purl into the front of the next stitch but do not slip it off. Purl into the back of the same stitch, then slip it off (pfb). 1 stitch became 2.'], delta: 1 };
  if (/^m1l$/.test(t)) return { steps: ['Make 1 left (M1L): lift the bar between the stitches from front to back and knit it through the back loop.'], delta: 1 };
  if (/^m1r$/.test(t)) return { steps: ['Make 1 right (M1R): lift the bar between the stitches from back to front and knit it through the front loop.'], delta: 1 };
  if (/^m1p$/.test(t)) return { steps: ['Make 1 purlwise (M1P): lift the bar between the stitches and purl it.'], delta: 1 };
  if (/^(?:m1|make 1)$/.test(t)) return { steps: ['Make 1 stitch (M1): lift the bar between the stitches onto the left needle and knit it through the back loop.'], delta: 1 };
  if (/^(?:inc|increase)(?: 1)?(?: st)?$/.test(t)) return { steps: ['Increase 1 stitch.'], delta: 1 };
  if (/^(?:yo|yrn|yfwd|yon|yarn over)$/.test(t)) return { steps: ['Make 1 yarn over (bring the yarn to the front, then over the right needle).'], delta: 1 };

  // decreases
  if (/^k2tog$/.test(t)) return { steps: ['Knit the next 2 stitches together (k2tog).'], delta: -1 };
  if (/^k3tog$/.test(t)) return { steps: ['Knit the next 3 stitches together (k3tog).'], delta: -2 };
  if (/^p2tog$/.test(t)) return { steps: ['Purl the next 2 stitches together (p2tog).'], delta: -1 };
  if (/^p3tog$/.test(t)) return { steps: ['Purl the next 3 stitches together (p3tog).'], delta: -2 };
  if (/^ssk$/.test(t)) return { steps: ['Slip the next stitch knitwise.', 'Slip the following stitch knitwise.', 'Knit those 2 slipped stitches together through the back (ssk).'], delta: -1 };
  if (/^ssp$/.test(t)) return { steps: ['Slip the next 2 stitches knitwise, one at a time.', 'Put them back on the left needle and purl them together through the back (ssp).'], delta: -1 };
  if (/^sssk$/.test(t)) return { steps: ['Slip 3 stitches knitwise, one at a time.', 'Knit those 3 together through the back (sssk).'], delta: -2 };
  if (/^(?:sk2p|s2kp2?|cdd)$/.test(t)) return { steps: ['Slip 2 stitches together knitwise, knit 1, then pass the 2 slipped stitches over (a centred double decrease).'], delta: -2 };
  if (/^psso$/.test(t)) return { steps: ['Pass the slipped stitch over the stitch you just worked (psso).'], delta: -1 };
  if (/^(?:dec|decrease)(?: 1)?(?: st)?$/.test(t)) return { steps: ['Decrease 1 stitch.'], delta: -1 };

  // slip and markers
  m = t.match(/^sl(?:ip)?\s*(\d+)?(?:\s*sts)?\s*(wyif|wyib|knitwise|purlwise|kwise|pwise)?$/);
  if (m) {
    const k = m[1] ? Number(m[1]) : 1;
    const how = m[2] ? ({ wyif: ' with the yarn in front', wyib: ' with the yarn in back', knitwise: ' knitwise', kwise: ' knitwise', purlwise: ' purlwise', pwise: ' purlwise' } as Record<string, string>)[m[2]] : '';
    return { steps: [`Slip ${sts(k)}${how} from the left needle to the right needle without working ${k === 1 ? 'it' : 'them'}.`] };
  }
  if (/^(?:sm|slip (?:the )?marker|slip marker)$/.test(t)) return { steps: ['Slip the marker from the left needle to the right needle.'] };
  if (/^(?:pm|place (?:a )?marker|place (?:the )?(?:bor|beginning[- ]of[- ]round)(?: marker)?|place marker for (?:the )?(?:bor|beginning of (?:the )?round))$/.test(t)) {
    return { steps: [/bor|beginning/.test(t) ? 'Place a marker on the right needle to mark the beginning of the round.' : 'Place a marker on the right needle.'], marker: true };
  }
  if (/^remove (?:the )?(?:all )?(?:other )?(?:[a-z]+ )?markers?$/.test(t)) return { steps: ['Take the marker off the needle as you reach it.'] };


  // named things the pattern talks about
  m = t.match(/^(k|p|knit|purl)\s+(?:the\s+)?(?:stitches of the\s+)?((?:[a-z]+ )?panel)$/);
  if (m) return { steps: [`${/^k/.test(m[1]) ? 'Knit' : 'Purl'} the stitches of the ${m[2]}.`] };
  m = t.match(/^place (?:a |the )?([a-z]+(?: [a-z]+)?) marker$/);
  if (m && !/^(bor|beginning)/.test(m[1])) return { steps: [`Place a marker here (${m[1].toUpperCase().length <= 3 ? m[1].toUpperCase() : m[1]} marker).`], marker: true };
  m = t.match(/^beginning at (.+)$/);
  if (m) return { steps: [`Start at ${m[1]}.`] };
  m = t.match(/^(?:knit|work) (?:a |1 )(?:single )?(round|row)$/);
  if (m) return { steps: [`Knit 1 ${m[1]}: knit every stitch.`] };
  m = t.match(/^(?:then )?proceed to (.+)$/);
  if (m) return { steps: [`Next you will move on to: ${m[1]}.`], note: true };


  // a row laid out in sections: "9 garter sts (= front band), M.1 on the next 190 sts, 9 garter sts"
  m = t.match(/^(?:finish with )?(?:the )?(?:first |next |last )?(\d+) (garter|stockinette|rib|reverse stockinette) sts?(?: \(([^)]*)\))?$/);
  if (m) {
    const label = m[3] ? ` (${m[3].replace(/^=\s*/, '')})` : '';
    return { steps: [`Work ${sts(Number(m[1]))} in ${m[2]} stitch${label}.`], layout: Number(m[1]) };
  }
  m = t.match(/^([a-z]\.\d+|[a-z]+ ?\d+|chart [a-z0-9]+) on the next (\d+) sts?(?: \(([^)]*)\))?$/);
  if (m) {
    const name = m[1].toUpperCase();
    return { steps: [`Work the next ${sts(Number(m[2]))} in pattern ${name} (the ${name} rows are in the pattern section of the original).`], layout: Number(m[2]) };
  }
  m = t.match(/^(stockinette|garter|rib|reverse stockinette) (?:stitch|st|sts) on the next (\d+) sts?(?: \(([^)]*)\))?$/);
  if (m) return { steps: [`Work the next ${sts(Number(m[2]))} in ${m[1]} stitch.`], layout: Number(m[2]) };
  m = t.match(/^(?:continue|work) (?:in )?(stockinette|garter)(?: stitch| st| sts)?$/);
  if (m) return { steps: [`Work in ${m[1]} stitch from now on.`] };


  m = t.match(/^work (\d+) (rows?|rounds?)(?: in)? garter(?: sts?| stitch)?$/);
  if (m) return { steps: [`Knit every stitch for ${m[1]} ${m[2]}.${/row/.test(m[2]) ? ' Turn your work at the end of each row.' : ''}`], delta: 0 };
  m = t.match(/^continue in ([a-z]\.\d+)(?: with (\d+) edge sts? (?:on )?each side)?$/);
  if (m) return { steps: [`Work in pattern ${m[1].toUpperCase()}${m[2] ? `, with ${sts(Number(m[2]))} at each side as edge stitches (worked plain)` : ''}.`] };
  m = t.match(/^work (garter|stockinette)(?: stitch| sts?)? on the (?:middle|centre) (\d+) sts?(?: with (?:the )?remaining sts as before)?$/);
  if (m) return { steps: [`Work the middle ${sts(Number(m[2]))} in ${m[1]} stitch and keep the other stitches as you have been working them.`] };
  m = t.match(/^bind off the (?:middle|centre) (\d+) sts?(?: for (?:the )?neck(?:line)?)?$/);
  if (m) return { steps: [`Bind off the middle ${sts(Number(m[1]))} for the neck.`], delta: -Number(m[1]) };

  // shaping at the sides: "dec 1 st on each side of both markers", "inc 1 st each side"
  m = t.match(/^(dec|inc|decrease|increase) (\d+) sts?( on each side of both markers| on each side of (?:the )?markers?| each side of both markers| each side| on each side| on both sides| at each end| at both ends)?(?: as follows| from rs)?$/);
  if (m) {
    const dec = /^dec/.test(m[1]);
    const k = Number(m[2]);
    const where = m[3]?.trim() ?? '';
    const both = /markers/.test(where);
    const sides = both ? 4 : where ? 2 : 1;
    const verb = dec ? 'Decrease' : 'Increase';
    const how = dec ? ' Use k2tog where the decrease should lean right and ssk where it should lean left (your pattern may give a different method).' : ' Use a make-1 (M1L / M1R) or a yarn over worked twisted on the next row, unless your pattern names a method.';
    const text = both
      ? `${verb} ${sts(k)} on each side of BOTH markers: ${sts(k * 4)} in the row (one before and one after each marker).`
      : where
        ? `${verb} ${sts(k)} at each side: ${sts(k * 2)} in the row, inside the edge stitches.`
        : `${verb} ${sts(k)}.`;
    return { steps: [text + how], delta: (dec ? -1 : 1) * k * sides };
  }
  m = t.match(/^bind off (\d+) sts?( on each side of both markers| each side of both markers| on each side| each side)?(?: for (?:the )?armhole)?$/);
  if (m && m[2]) {
    const k = Number(m[1]);
    const both = /markers/.test(m[2]);
    return { steps: [both ? `Bind off ${sts(k)} on each side of BOTH markers (${sts(k * 4)} in all: ${sts(k)} before and after each marker) for the armholes.` : `Bind off ${sts(k)} at each side for the armhole.`], delta: -k * (both ? 4 : 2) };
  }
  if (/^(?:now )?complete each (?:piece|shoulder) separately$/.test(t)) return { steps: ['From here each piece is knitted separately (back and each front).'], note: true };

  // turning, joining, structure
  if (/^turn(?: (?:your )?work)?$/.test(t)) return { steps: ['Turn your work.'], turn: true };
  if (/^join(?: for| to)?(?: working| work)?(?: in the round)?(?: without twisting)?(?:,? (?:being careful )?(?:not to|to avoid) twist(?:ing)?(?: the sts)?)?$/.test(t) && /round|twist/.test(t)) {
    return { steps: ['Join in the round: bring the last stitch next to the first without twisting the stitches, and start knitting round and round.'], join: true };
  }
  if (/^stop$/.test(t)) return { steps: ['Stop here.'] };
  if (/^(?:work|continue)(?: in)? (?:pattern|patt|stitch pattern)(?: as established)?$/.test(t) || /^work as established$/.test(t) || /^work even$/.test(t)) {
    return { steps: ['Keep working the stitch pattern exactly as you have been (knit the knits, purl the purls, garter panels in garter).'] };
  }
  m = t.match(/^work in pattern to (.+)$/);
  if (m) {
    const s = target(m[1], 'Work');
    return s ? { steps: [s.replace(/^Work/, 'Keep working in pattern').replace('Keep working in pattern to', 'Keep working in pattern up to').replace('Keep working in pattern until', 'Keep working in pattern until')] } : null;
  }
  if (/^(?:work|knit) (?:the )?(?:garter|stockinette|rib)(?: (?:stitch|st))?$/.test(t) || /^(?:work|knit) in (?:garter|stockinette|rib)(?: (?:stitch|st))?$/.test(t)) {
    return { steps: [/garter/.test(t) ? 'Work in garter stitch (knit every stitch, or knit one round and purl one round in the round).' : /rib/.test(t) ? 'Work in rib: knit the knit stitches and purl the purl stitches as they face you.' : 'Work in stockinette (knit the right side, purl the wrong side; in the round, knit every round).'] };
  }

  // cast on, bind off, hold, pick up
  m = t.match(/^cast on (\d+)(?: sts)?(?: using (?:the )?(.+?)(?: method)?)?(?: \(([^)]*)\))?$/);
  if (m) return { steps: [`Cast on ${sts(Number(m[1]))}${m[2] ? ` using the ${m[2]} method` : ''}${m[3] ? ` (${m[3]})` : ''}.`], delta: Number(m[1]) };
  m = t.match(/^(?:bind|cast) off(?: (\d+))?(?: sts)?(?: all sts)?(?: (loosely|knitwise|purlwise|in pattern))?$/);
  if (m) return { steps: [`Bind off ${m[1] ? sts(Number(m[1])) : 'all stitches'}${m[2] ? ` ${m[2]}` : ''}.`], delta: m[1] ? -Number(m[1]) : undefined, empties: !m[1] };
  m = t.match(/^place (?:the )?(?:next )?(\d+) sts(?: (?:to|up to) the next marker)? on (?:hold|a (?:stitch )?holder|waste yarn)(?: on (?:waste yarn|a (?:stitch )?holder))?(?: \(([^)]*)\))?$/);
  if (m) return { steps: [`Slide the next ${sts(Number(m[1]))} off your needle onto waste yarn or a stitch holder${m[2] ? ` (${m[2]})` : ''}. Do not knit them. They stay live for later.`], delta: -Number(m[1]) };
  m = t.match(/^place (?:the )?(\d+) held sts back onto (?:the )?(.+)$/);
  if (m) return { steps: [`Slide the ${sts(Number(m[1]))} you put on hold back onto ${/needle/.test(m[2]) ? `your ${m[2].replace(/^the /, '')}` : m[2]}.`], delta: 0, reset: Number(m[1]) };
  m = t.match(/^pick up and knit (?:a further )?(\d+|one) sts?(?: in each (?:sts?|stitch)(?: (?:cast-on|cast on))?)?(?: (.+))?$/);
  if (m && /^one$/.test(m[1])) return { steps: ['Pick up and knit 1 stitch in each cast-on stitch around the edge: put the needle into each one, wrap the yarn and pull a loop through.'], delta: undefined };
  if (m) return { steps: [`Pick up and knit ${sts(Number(m[1]))}${m[2] ? ` ${m[2]}` : ''}: put the needle into the edge, wrap the yarn and pull a loop through for each one.`], delta: Number(m[1]) };
  if (/^knit around(?: the)?(?: previously)? held sts$/.test(t)) return { steps: ['Knit across the stitches you moved back onto the needle.'], delta: 0 };
  m = t.match(/^(?:knit|work) (\d+) sts?(?: to the next marker)?(?: \(([^)]*)\))?$/);
  if (m) return { steps: [`Knit ${sts(Number(m[1]))}${/to the next marker/.test(t) ? ' (up to the next marker)' : ''}${m[2] ? ` (${m[2]})` : ''}.`] };
  if (/\bas (?:at|for|on) (?:the )?(?:right|left|first|previous|other)\b/.test(t)) {
    return { steps: [`Same again for the other side, with the same number of stitches (${clean(raw)}).`], delta: undefined };
  }

  // German short rows
  if (/^double the (?:sts|st)$/.test(t)) return { steps: ['Make a doubled stitch (German short row): slip the first stitch purlwise with the yarn at the front, then pull the yarn up and over the needle so the stitch shows as 2 loops.'], delta: 0 };
  return null;
}

/* ------------------------------------------------------------ tokenising */

type Node =
  | { kind: 'atom'; text: string }
  | { kind: 'group'; nodes: Node[]; times?: number; until?: string };

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === ',' || ch === ';')) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  // "knit 1 and place marker" / "k2tog then k1": split words that join two atoms
  return out
    .flatMap((p) => p.split(/\s+(?:then|and then)\s+/i))
    .flatMap((p) =>
      p
        .replace(/\bpick up and knit\b/gi, 'pick up AND_KNIT')
        .split(/\s+and\s+(?=(?:join|continue|place|pm|sm|remove|turn|stop|knit|purl|k\d|p\d|work|slip|sl\b|cast|bind|pick|finish|dec|inc|now|complete|m\.\d))/i)
        .map((x) => x.replace(/AND_KNIT/g, 'and knit')),
    )
    .map((p) => p.trim())
    .filter(Boolean);
}

function timesOf(after: string): { n?: number; to?: string; len: number } | null {
  const m = after.match(/^\s*(?:,?\s*)?(?:(\d+) times|(once|twice|thrice|three times|four times|five times|six times)|(?:to|until) (.+?))(?=[,.\]]|$)/i);
  if (!m) return null;
  if (m[1]) return { n: Number(m[1]), len: m[0].length };
  if (m[2]) return { n: WORD_NUM[m[2].toLowerCase()], len: m[0].length };
  return { to: m[3], len: m[0].length };
}

function parse(text: string): Node[] | null {
  // "* a, b *, work from *-* until there are 8 stitches left"
  const star = text.match(/^(.*?)\*\s*(.+?)\s*\*,?\s*(?:work|repeat) from \*(?:\s*(?:-|to)\s*\*)?\s*(until (?:there are )?(\d+) (?:stitches|sts?)(?: left| remain(?:ing)?)?|to end|to last (\d+) (?:stitches|sts?))(.*)$/i);
  if (star) {
    const head = star[1].trim().replace(/,$/, '');
    const inner = parse(star[2]);
    if (!inner) return null;
    const tail = star[6].replace(/^[\s,]+/, '');
    const stop = star[4] ? `${star[4]} stitches remain` : star[5] ? `${star[5]} stitches remain` : 'the end';
    const nodes: Node[] = [];
    if (head) {
      const h = parse(head);
      if (!h) return null;
      nodes.push(...h);
    }
    nodes.push({ kind: 'group', nodes: inner, until: stop });
    if (tail) {
      const t = parse(tail);
      if (!t) return null;
      nodes.push(...t);
    }
    return nodes;
  }
  const out: Node[] = [];
  const parts = splitTop(text);
  for (let i = 0; i < parts.length; i++) {
    let p = parts[i];
    if (p.startsWith('[')) {
      // find the matching bracket inside this part (parts were split at top level, so it is within p or spans parts)
      let depth = 0;
      let end = -1;
      for (let k = 0; k < p.length; k++) {
        if (p[k] === '[') depth++;
        if (p[k] === ']') {
          depth--;
          if (depth === 0) {
            end = k;
            break;
          }
        }
      }
      if (end < 0) return null;
      const inner = parse(p.slice(1, end));
      if (!inner) return null;
      const rest = p.slice(end + 1);
      const tm = timesOf(rest);
      out.push({ kind: 'group', nodes: inner, times: tm?.n, until: tm?.to });
      p = rest.slice(tm?.len ?? 0).trim();
      if (p) out.push({ kind: 'atom', text: p });
      continue;
    }
    out.push({ kind: 'atom', text: p });
  }
  return out;
}

/* -------------------------------------------------------------- evaluate */

interface Acc {
  layoutTotal?: number;
  startAt?: number;
  empties?: boolean;
  steps: OpStep[];
  delta: number;
  known: boolean;
  join: boolean;
  turns: number;
  markers: number;
}

function run(nodes: Node[], acc: Acc, indent = false): boolean {
  for (const n of nodes) {
    if (n.kind === 'atom') {
      const a = atom(n.text);
      if (!a) return false;
      for (const s of a.steps) acc.steps.push({ note: a.note, text: indent ? `• ${s}` : s, tech: techniquesIn(s).concat(/kfb|pfb/i.test(n.text) ? ['kfb'] : [], /^ssp$/i.test(clean(n.text)) ? ['ssp'] : []) });
      if (a.reset !== undefined && acc.startAt === undefined && acc.steps.length === a.steps.length) acc.startAt = a.reset;
      if (a.layout !== undefined) acc.layoutTotal = (acc.layoutTotal ?? 0) + a.layout;
      if (a.empties) acc.empties = true;
      if (a.delta === undefined && a.empties) acc.known = true;
      else if (a.delta === undefined && /^(?:bind|cast) off$/i.test(clean(n.text))) acc.known = false;
      else if (a.delta === undefined && /as (?:at|for|on)/i.test(n.text)) acc.known = false;
      else acc.delta += a.delta ?? 0;
      if (a.join) acc.join = true;
      if (a.turn) acc.turns++;
      if (a.marker) acc.markers++;
    } else {
      const inner: Acc = { steps: [], delta: 0, known: true, join: false, turns: 0, markers: 0 };
      if (!run(n.nodes, inner, true)) return false;
      const head = n.times ? (n.times === 1 ? 'Do this once:' : `Do this ${n.times} times:`) : n.until ? `Repeat this until ${/^the end$/.test(n.until) ? 'the end of the row or round' : n.until.replace(/^there are /, '')}:` : 'Work this group:';
      acc.steps.push({ text: head, tech: [], note: true });
      acc.steps.push(...inner.steps.map((s) => ({ ...s, text: s.text.startsWith('•') ? s.text : `• ${s.text}` })));
      if (n.times) acc.delta += inner.delta * n.times;
      else if (inner.delta !== 0) acc.known = false;
      acc.known = acc.known && inner.known;
      if (inner.layoutTotal !== undefined) acc.layoutTotal = (acc.layoutTotal ?? 0) + inner.layoutTotal * (n.times ?? 1);
      acc.join = acc.join || inner.join;
      acc.turns += inner.turns * (n.times ?? 1);
      acc.markers += inner.markers * (n.times ?? 1);
    }
  }
  return true;
}

/** Pull "[124 sts]", "[8 sts inc - 2 sts per section]" notes off the end of a sequence. */
export function stripNotes(text: string): { body: string; total?: number; change?: number } {
  let body = text.trim();
  let total: number | undefined;
  let change: number | undefined;
  for (;;) {
    const m = body.match(/\s*\[([^\[\]]*)\]\s*\.?$/);
    if (!m) break;
    const inner = m[1];
    const tot = inner.match(/^(\d+)\s*(?:[a-z]+\s+)?(?:total\s+)?(?:stitches|sts?)\b/i);
    const ch = inner.match(/^(\d+)\s*(?:stitches|sts?)\s*(inc|dec)/i);
    if (ch) change = (ch[2].toLowerCase() === 'inc' ? 1 : -1) * Number(ch[1]);
    else if (tot) total = total ?? Number(tot[1]);
    else break;
    body = body.slice(0, m.index).trim();
  }
  return { body, total, change };
}

export function interpretSequence(textIn: string): OpResult | null {
  const { body, total, change } = stripNotes(textIn.replace(/\.$/, ''));
  if (!body) return null;
  const nodes = parse(body);
  if (!nodes || !nodes.length) return null;
  const acc: Acc = { steps: [], delta: 0, known: true, join: false, turns: 0, markers: 0 };
  if (!run(nodes, acc)) return null;
  return { layoutTotal: acc.layoutTotal, startAt: acc.startAt, endsEmpty: acc.empties, steps: acc.steps, delta: acc.delta, deltaKnown: acc.known, statedTotal: total, statedChange: change, joinRound: acc.join, turns: acc.turns, markersPlaced: acc.markers };
}
