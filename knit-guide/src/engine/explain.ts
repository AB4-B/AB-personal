/**
 * EXPLAIN THIS / abbreviation lookup.
 *
 * Everything here is GUIDANCE generated locally by simple rules (no AI service).
 * It is always shown under its own label, never mixed into the designer's text.
 * Where the pattern defines a term itself, that definition is shown first.
 */
import type { Abbreviation } from '../model/types';

export interface GlossaryEntry {
  /** what it stands for */
  name: string;
  /** plain-English steps */
  plain: string;
}

export const BUILTIN: Record<string, GlossaryEntry> = {
  k: { name: 'knit', plain: 'Insert the right needle into the next stitch from front to back, wrap the yarn and pull a loop through.' },
  p: { name: 'purl', plain: 'Insert the right needle into the next stitch from back to front, wrap the yarn and pull a loop through.' },
  yo: { name: 'yarn over', plain: 'Bring the yarn forward and make a yarn over: it makes a new stitch and a small hole.' },
  ssk: { name: 'slip, slip, knit', plain: 'Slip two stitches knitwise one at a time, then knit them together through the back loops. Slants left.' },
  k2tog: { name: 'knit 2 together', plain: 'Knit the next two stitches together as one. Slants right.' },
  k3tog: { name: 'knit 3 together', plain: 'Knit the next three stitches together as one (a double decrease).' },
  p2tog: { name: 'purl 2 together', plain: 'Purl the next two stitches together as one.' },
  ssp: { name: 'slip, slip, purl', plain: 'Slip two stitches knitwise one at a time, return them to the left needle and purl them together through the back loops.' },
  sl: { name: 'slip', plain: 'Move a stitch from the left needle to the right needle without working it.' },
  sl1: { name: 'slip 1', plain: 'Move one stitch from the left needle to the right needle without working it. Your pattern says whether knitwise or purlwise.' },
  pm: { name: 'place marker', plain: 'Put a stitch marker on the right needle.' },
  sm: { name: 'slip marker', plain: 'Move the marker from the left needle to the right needle.' },
  co: { name: 'cast on', plain: 'Create new stitches on the needle.' },
  bo: { name: 'bind off', plain: 'Finish stitches so they do not unravel.' },
  m1: { name: 'make 1', plain: 'Add one stitch between two stitches. Use the method the pattern describes.' },
  kfb: { name: 'knit front and back', plain: 'Knit into the front of the stitch, then into the back of the same stitch before dropping it.' },
  rs: { name: 'right side', plain: 'The side of the work that will face outward when worn.' },
  ws: { name: 'wrong side', plain: 'The side of the work that will face inward when worn.' },
  st: { name: 'stitch', plain: 'One loop on the needle.' },
  sts: { name: 'stitches', plain: 'Loops on the needle.' },
  rep: { name: 'repeat', plain: 'Do the marked section again.' },
  rnd: { name: 'round', plain: 'One trip around when knitting in the round.' },
  dpn: { name: 'double-pointed needles', plain: 'A set of short needles with a point at both ends.' },
  'pu&k': { name: 'pick up and knit', plain: 'Pull new loops through the edge of the work onto the needle.' },
  psso: { name: 'pass slipped stitch over', plain: 'Lift the slipped stitch over the stitch(es) just knit and off the needle.' },
};

const DIGIT_OK = new Set(['k', 'p', 'sl']);

export interface TermInfo {
  key: string;
  display: string;
  fromPattern?: string;
  builtin?: GlossaryEntry;
}

export function buildLookup(abbrs: Abbreviation[]) {
  const pattern = new Map<string, Abbreviation>();
  for (const a of abbrs) pattern.set(a.abbr.toLowerCase(), a);
  return (word: string): TermInfo | undefined => {
    const w = word.toLowerCase();
    let key = w;
    if (!pattern.has(key) && !BUILTIN[key]) {
      const stripped = w.replace(/\d+$/, '');
      if (stripped !== w && DIGIT_OK.has(stripped) && (pattern.has(stripped) || BUILTIN[stripped])) key = stripped;
      else return undefined;
    }
    const p = pattern.get(key);
    const b = BUILTIN[key];
    if (!p && !b) return undefined;
    return { key, display: p?.abbr ?? key, fromPattern: p?.definition, builtin: b };
  };
}

export type AbbrPart = { type: 'text'; text: string } | { type: 'term'; text: string; info: TermInfo };

/** Split text into plain text and tappable abbreviations. */
export function tokenizeAbbreviations(text: string, abbrs: Abbreviation[]): AbbrPart[] {
  const lookup = buildLookup(abbrs);
  const parts: AbbrPart[] = [];
  let pos = 0;
  for (const m of text.matchAll(/[A-Za-z][A-Za-z0-9&]*/g)) {
    const info = lookup(m[0]);
    if (!info) continue;
    // single letters only when they look like stitch ops (k2, p10) or are listed by the pattern
    if (m[0].length === 1 && !info.fromPattern) continue;
    if (m.index! > pos) parts.push({ type: 'text', text: text.slice(pos, m.index!) });
    parts.push({ type: 'term', text: m[0], info });
    pos = m.index! + m[0].length;
  }
  if (pos < text.length) parts.push({ type: 'text', text: text.slice(pos) });
  return parts;
}

/* ---------------------------------------------------------------- explain */

export interface Explanation {
  steps: string[];
  terms: TermInfo[];
  /** things the generator could not translate */
  untranslated: string[];
  /** e.g. numbers resolved for the selected size */
  notes: string[];
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if ((ch === ',' || ch === ';') && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

/** Convert one comma-separated token to plain steps, or null if it is not a known stitch op. */
function stepsForToken(tokenIn: string): string[] | null {
  const token = tokenIn
    .replace(/\bk\s*(\d*)\s*tog\b/gi, (_m, n) => `k${n}tog`)
    .replace(/\bp\s*(\d*)\s*tog\b/gi, (_m, n) => `p${n}tog`)
    .trim();
  const m = token.match(/^([a-z][a-z0-9&]*?)(\d*)\s*(?:sts?|stitch(?:es)?)?\s*(?:\(([^)]*)\))?\s*\.?$/i);
  if (!m) return null;
  const op = m[1].toLowerCase();
  const n = m[2] ? Number(m[2]) : undefined;
  const label = m[3] ? ` (${m[3]})` : '';
  switch (op) {
    case 'k':
      return [`Knit ${plural(n ?? 1, 'stitch').replace('stitchs', 'stitches')}${label}.`];
    case 'p':
      return [`Purl ${plural(n ?? 1, 'stitch').replace('stitchs', 'stitches')}${label}.`];
    case 'yo':
      return ['Bring the yarn forward and make a yarn over.'];
    case 'ssk':
      return [
        'Slip the next two stitches knitwise, one at a time.',
        'Insert the left needle into the front of those two slipped stitches and knit them together.',
      ];
    case 'k2tog':
      return ['Knit the next two stitches together as one.'];
    case 'k3tog':
      return ['Knit the next three stitches together as one.'];
    case 'p2tog':
      return ['Purl the next two stitches together as one.'];
    case 'sl':
    case 'sl1':
      return [`Slip 1 stitch${label} (your pattern says knitwise or purlwise).`];
    case 'pm':
      return [`Place a stitch marker${label}.`];
    case 'sm':
      return ['Slip the marker from the left needle to the right needle.'];
    case 'knit':
      return ['Knit every stitch.'];
    case 'purl':
      return ['Purl every stitch.'];
    default:
      return null;
  }
}

export function explain(
  /** instruction text with the selected size already resolved */
  resolvedText: string,
  abbrs: Abbreviation[],
  sizeNotes: string[] = [],
): Explanation {
  const lookup = buildLookup(abbrs);
  const terms = new Map<string, TermInfo>();
  for (const m of resolvedText.matchAll(/[A-Za-z][A-Za-z0-9&]*/g)) {
    const t = lookup(m[0]);
    if (t && (m[0].length > 1 || t.fromPattern)) terms.set(t.key, t);
  }

  const steps: string[] = [];
  const untranslated: string[] = [];
  const lines = resolvedText.split('\n');
  for (const line of lines) {
    // "Row 1: k2, yo, ssk" / "Set-up row (WS): k1, p1" -> keep heading out, explain the body
    const hm = line.match(/^((?:set-?up\s+)?(?:next\s+)?(?:rows?|rounds?)[^:]{0,40}):\s*(.+)$/i);
    const body = hm ? hm[2] : line;
    const tokens = splitTopLevel(body.replace(/\.$/, ''));
    const translated = tokens.map((t) => stepsForToken(t));
    const known = translated.filter(Boolean).length;
    if (tokens.length && known === tokens.length) {
      if (hm) steps.push(`${hm[1]}:`);
      translated.forEach((s) => steps.push(...s!));
    } else if (known > 0 && tokens.length > 1) {
      if (hm) steps.push(`${hm[1]}:`);
      tokens.forEach((t, i) => {
        if (translated[i]) steps.push(...translated[i]!);
        else {
          steps.push(`Follow the pattern for: "${t}"`);
          untranslated.push(t);
        }
      });
    } else {
      untranslated.push(line);
    }
  }
  return { steps, terms: [...terms.values()], untranslated, notes: sizeNotes };
}
