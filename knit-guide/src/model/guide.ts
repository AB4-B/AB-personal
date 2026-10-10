/**
 * THE GUIDE LAYER.
 *
 * Source layer : Instruction.text, verbatim, all sizes, original units. Never changed.
 * Guide layer  : what this file builds for ONE selected size, in metric only:
 *   - every size list (`50 [50, 54, …]`, `11-11-13-13`) becomes the single number for the size
 *   - `SIZE S: … / SIZE M: …` lists keep only the selected size's line
 *   - sections written for other sizes are hidden
 *   - imperial measures become metric
 * Anything that cannot be mapped safely is NOT guessed: it becomes a review value that the knitter
 * resolves once; the answer is stored as a project override.
 */
import { findSizeGroups, type SizeGroup } from './size';
import { toMetric } from './units';
import type { Instruction, Pattern, Section } from './types';

export interface GuideCtx {
  pattern: Pattern;
  size: string;
  overrides: Record<string, string>;
}

export interface ReviewValue {
  key: string;
  raw: string;
  values: string[];
  reason: string;
}

export type GuidePart =
  | { type: 'text'; text: string }
  | { type: 'review'; key: string; raw: string };

export interface Guided {
  hidden: boolean;
  parts: GuidePart[];
  /** guided text as one string (review values show the original list) */
  plain: string;
  review: ReviewValue[];
  resolved: number;
  overridden: string[];
  measurementFlags: string[];
}

export const groupKey = (insId: string, idx: number) => `${insId}#${idx}`;
const SIZE_LINE = /^sizes?\s+(\S+?)\s*:\s*(.*)$/i;
const MARK = (k: string) => `⟦${k}⟧`;

export function sectionOf(pattern: Pattern, ins: Instruction): Section | undefined {
  return pattern.sections.find((s) => s.id === ins.sectionId);
}

/** Sizes a list in this instruction is written for (the section's own size list, else all sizes). */
export function listSizesFor(pattern: Pattern, ins: Instruction): string[] {
  const sec = sectionOf(pattern, ins);
  const parent = sec?.parentId ? pattern.sections.find((s) => s.id === sec.parentId) : undefined;
  return ins.appliesTo ?? sec?.appliesTo ?? parent?.appliesTo ?? pattern.sizes;
}

export function appliesToSize(pattern: Pattern, ins: Instruction, size: string): boolean {
  const sec = sectionOf(pattern, ins);
  const parent = sec?.parentId ? pattern.sections.find((s) => s.id === sec.parentId) : undefined;
  const lists = [ins.appliesTo, sec?.appliesTo, parent?.appliesTo].filter(Boolean) as string[][];
  return lists.every((l) => l.includes(size));
}

export const sectionVisible = (sec: Section, size: string) =>
  !sec.appliesTo || sec.appliesTo.includes(size);

/** Map a size-list group to the value for `size`, or explain why it cannot be done. */
export function resolveGroup(
  g: SizeGroup,
  listSizes: string[],
  size: string,
): { value?: string; reason?: string } {
  if (g.values.length !== listSizes.length) {
    return { reason: `This list has ${g.values.length} numbers but there are ${listSizes.length} sizes${listSizes.length === 1 ? '' : ` (${listSizes.join(', ')})`}.` };
  }
  const idx = listSizes.indexOf(size);
  if (idx < 0) return { reason: `Size ${size} is not one of the sizes this list is written for.` };
  const v = g.values[idx]?.trim();
  if (!v) return { reason: 'The number for your size is missing.' };
  return { value: v };
}

/** The size lists in an instruction (one shared definition, so override keys always line up). */
export function groupsFor(pattern: Pattern, ins: Instruction): SizeGroup[] {
  return findSizeGroups(ins.text, pattern.sizes.length, listSizesFor(pattern, ins).length);
}

export function guideInstruction(ins: Instruction, ctx: GuideCtx): Guided {
  const { pattern, size, overrides } = ctx;
  const empty: Guided = { hidden: true, parts: [], plain: '', review: [], resolved: 0, overridden: [], measurementFlags: [] };
  if (ins.scopeMarker || ins.tableRow || !appliesToSize(pattern, ins, size)) return empty;

  let text = ins.text;

  // "SIZE S: … / SIZE M: …": keep only my size's line, without its label
  const lines = text.split('\n');
  const sizeLines = lines.filter((l) => SIZE_LINE.test(l));
  const review: ReviewValue[] = [];
  let resolved = 0;
  if (sizeLines.length >= 3) {
    const mine = sizeLines.find((l) => l.match(SIZE_LINE)![1].toUpperCase() === size.toUpperCase());
    const key = groupKey(ins.id, -1);
    const kept = lines.filter((l) => !SIZE_LINE.test(l));
    if (mine) {
      kept.push(mine.match(SIZE_LINE)![2]);
      resolved++;
    } else if (overrides[key]) {
      kept.push(overrides[key]);
      resolved++;
    } else {
      kept.push(MARK(key));
      review.push({ key, raw: sizeLines.join('\n'), values: [], reason: `No line for size ${size} was found in this size list.` });
    }
    text = kept.join('\n');
  }

  // size lists
  const listSizes = listSizesFor(pattern, ins);
  const groups = groupsFor(pattern, ins);
  const overridden: string[] = [];
  let out = '';
  let pos = 0;
  const source = sizeLines.length >= 3 ? null : ins.text;
  if (source) {
    groups.forEach((g, i) => {
      out += source.slice(pos, g.start);
      const key = groupKey(ins.id, i);
      const res = resolveGroup(g, listSizes, size);
      if (overrides[key] !== undefined) {
        out += overrides[key];
        overridden.push(key);
        resolved++;
      } else if (res.value !== undefined) {
        // keep an inch mark so the metric step can still recognise "6¾"" as inches
        out += res.value + (/["”″]/.test(g.raw) ? '"' : '');
        resolved++;
      } else {
        out += MARK(key);
        review.push({ key, raw: g.raw, values: g.values, reason: res.reason ?? 'Could not be mapped to your size.' });
      }
      pos = g.end;
    });
    out += source.slice(pos);
    text = out;
  }

  // Safety net: a list of numbers for different sizes that was not recognised (a torn or oddly written list) must never
  // reach the knitter as if it were one instruction. It becomes a value to review.
  const LEFTOVER = /\d+(?:\.\d+)?\s*[(\[]\s*\d+(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?){2,}\s*,?\s*(?:[)\]]|$)/g;
  let leftN = 0;
  text = text.replace(LEFTOVER, (raw) => {
    const key = `${ins.id}#leftover${leftN++}`;
    if (overrides[key] !== undefined) {
      resolved++;
      overridden.push(key);
      return overrides[key];
    }
    review.push({ key, raw, values: [], reason: 'This looks like a list of numbers for different sizes, but it could not be matched to your size.' });
    return MARK(key);
  });

  const { text: metric, flags } = toMetric(text);
  const parts: GuidePart[] = [];
  let last = 0;
  for (const m of metric.matchAll(/⟦([^⟧]+)⟧/g)) {
    if (m.index! > last) parts.push({ type: 'text', text: metric.slice(last, m.index) });
    const r = review.find((x) => x.key === m[1]);
    parts.push({ type: 'review', key: m[1], raw: r?.raw ?? '' });
    last = m.index! + m[0].length;
  }
  if (last < metric.length) parts.push({ type: 'text', text: metric.slice(last) });
  const plain = parts.map((p) => (p.type === 'text' ? p.text : p.raw)).join('');
  return { hidden: false, parts, plain, review, resolved, overridden, measurementFlags: flags };
}

export const guidePlain = (ins: Instruction, ctx: GuideCtx) => guideInstruction(ins, ctx).plain;

/* ------------------------------------------------------------ resolution */

export interface Resolution {
  resolved: number;
  needsReview: { ins: Instruction; review: ReviewValue }[];
  hiddenInstructions: number;
  measurementFlags: number;
}

/** SIZE RESOLUTION summary for the Review screen and the guide banner. */
export function analyzeResolution(pattern: Pattern, size: string, overrides: Record<string, string> = {}): Resolution {
  const ctx = { pattern, size, overrides };
  const r: Resolution = { resolved: 0, needsReview: [], hiddenInstructions: 0, measurementFlags: 0 };
  for (const ins of pattern.instructions) {
    if (ins.kind === 'tracker') continue;
    const g = guideInstruction(ins, ctx);
    if (g.hidden) {
      r.hiddenInstructions++;
      continue;
    }
    r.resolved += g.resolved;
    r.measurementFlags += g.measurementFlags.length;
    for (const v of g.review) r.needsReview.push({ ins, review: v });
  }
  return r;
}

/** Sizes named by a heading such as "SIZES S, M, XL, XXL and XXXL (the increases in size L are finished)". */
export function sizesFromHeading(title: string, sizes: string[]): string[] | undefined {
  const m = title.match(/^sizes?\s+(.+?)\s*(?:\(.*\))?\s*:?$/i);
  if (!m) return undefined;
  const range = m[1].match(/^(\S+)\s+(?:-|–|to|through)\s+(\S+)$/i);
  const upper = sizes.map((s) => s.toUpperCase());
  if (range) {
    const a = upper.indexOf(range[1].toUpperCase());
    const b = upper.indexOf(range[2].toUpperCase());
    return a >= 0 && b >= a ? sizes.slice(a, b + 1) : undefined;
  }
  const toks = m[1].split(/\s*,\s*|\s+and\s+|\s*&\s*/i).map((t) => t.trim()).filter(Boolean);
  if (!toks.length || !toks.every((t) => upper.includes(t.toUpperCase()))) return undefined;
  return toks.map((t) => sizes[upper.indexOf(t.toUpperCase())]);
}

export function computeAppliesTo(sections: Section[], sizes: string[]) {
  for (const s of sections) {
    const a = sizesFromHeading(s.title, sizes);
    if (a) s.appliesTo = a;
    else delete s.appliesTo;
  }
}
