/**
 * PATTERN CHECK. Decides, for the selected size, which instructions the app understood reliably and which need the
 * knitter's attention. Nothing needs approving: an instruction that was interpreted without any doubt is simply
 * counted. Only the doubtful ones are listed, in four groups:
 *   - needs review      the wording (or a size value) could not be turned into steps safely
 *   - count differences the designer's stitch total and the app's arithmetic disagree
 *   - unsupported       charts and techniques the app cannot translate (short rows, cables, ...)
 */
import { analyzeResolution, type ReviewValue } from '../model/guide';
import type { Instruction, Pattern, Project } from '../model/types';
import { buildModel } from './flow';

export type UnsupportedKind = 'chart' | 'short rows' | 'cables' | 'other technique';

export interface CheckItem {
  ins: Instruction;
  title: string;
  /** the app's own summary of what went wrong, in plain words */
  reasons: string[];
  review: boolean;
  count: boolean;
  unsupported?: UnsupportedKind;
  /** size values that could not be mapped (resolved with the "choose my value" sheet) */
  sizeValues: ReviewValue[];
  /** the knitter has looked at a count difference and says it is fine */
  checked: boolean;
}

export interface PatternCheck {
  /** instructions that are part of the knitting (not notes, background or finishing text) */
  total: number;
  /** interpreted without doubt, plus the ones the knitter corrected */
  interpreted: number;
  corrected: Instruction[];
  items: CheckItem[];
  needsReview: number;
  countDifferences: number;
  unsupported: number;
}

const COUNT_MSG = /but you should have|but the pattern says|add up to|does not match|differs from|does not fit evenly/i;

export function unsupportedKind(text: string, hasChart: boolean): UnsupportedKind | undefined {
  if (hasChart || /\bchart\b|\bchart [a-z]\b|\bfollow (?:the )?(?:[a-z]+ )?chart/i.test(text)) return 'chart';
  if (/\bw&t\b|\bwrap(?:ped)?(?: and|&) turn\b|\bshort[- ]?rows?\b|\bdouble the stitch\b|\bgerman short\b|\bwrap\b.*\bturn\b/i.test(text)) return 'short rows';
  if (/\bcable\b|\bc[2-9][fb]\b|\bcn\b|\bcable needle\b/i.test(text)) return 'cables';
  if (/\b(?:3|three)-needle\b|\bcrochet\b|\bintarsia\b|\bfair ?isle\b|\bduplicate stitch\b|\bgrafting\b|\bkitchener\b/i.test(text)) return 'other technique';
  return undefined;
}

export function analyzePattern(pattern: Pattern, project: Project): PatternCheck {
  const model = buildModel(pattern, project);
  const res = analyzeResolution(pattern, project.size, project.sizeOverrides ?? {});
  const sizeByIns = new Map<string, ReviewValue[]>();
  for (const { ins, review } of res.needsReview) sizeByIns.set(ins.id, [...(sizeByIns.get(ins.id) ?? []), review]);
  const checked = project.knit?.checked ?? {};
  const overrides = project.knit?.guidanceOverrides ?? {};

  const items: CheckItem[] = [];
  const corrected: Instruction[] = [];
  let total = 0;
  for (const g of model.list) {
    if (g.kind === 'info' || g.kind === 'covered') continue;
    total++;
    const reasons: string[] = [];
    let review = g.review;
    let count = false;
    if (g.tr) {
      for (const s of g.tr.steps) if (s.review && s.original) reasons.push(`Could not be turned into steps: “${s.original.slice(0, 140)}”`);
      if (g.review && !reasons.length) reasons.push('The wording could not be safely turned into steps.');
      for (const a of g.tr.assumptions) if (COUNT_MSG.test(a)) { count = true; reasons.push(a); }
    }
    if (g.kind === 'yoke' && g.plan) for (const r of g.plan.review) { reasons.push(r); review = true; }
    if (g.kind === 'timeline' && g.timeline?.events.some((e) => e.review)) reasons.push('Some timed steps are shown in the designer’s own words.');
    const sizeValues = sizeByIns.get(g.ins.id) ?? [];
    if (sizeValues.length) { review = true; for (const v of sizeValues) reasons.push(v.reason); }
    const ack = checked[g.ins.id] !== undefined;
    if (overrides[g.ins.id] && !sizeValues.length) {
      corrected.push(g.ins);
      continue;
    }
    if (!review && !count && !sizeValues.length) continue;
    const unsupported = review ? unsupportedKind(g.ins.text, (g.ins.source.imageIds?.length ?? 0) > 0) : undefined;
    items.push({ ins: g.ins, title: g.title, reasons, review: review && !unsupported, count, unsupported, sizeValues, checked: ack });
  }
  const open = items.filter(needsAttention);
  return {
    total,
    interpreted: total - open.length,
    corrected,
    items,
    needsReview: items.filter((i) => i.review || i.sizeValues.length > 0).length,
    countDifferences: items.filter((i) => i.count && !i.checked).length,
    unsupported: items.filter((i) => i.unsupported).length,
  };
}

/** Still waiting for the knitter: a count difference she has accepted no longer counts. */
export const needsAttention = (i: CheckItem) => i.review || !!i.unsupported || i.sizeValues.length > 0 || (i.count && !i.checked);

export const attentionCount = (c: PatternCheck) => c.items.filter(needsAttention).length;
