/**
 * Pure editing helpers used by the REVIEW IMPORT screen. They change the *parsed
 * structure* (boundaries, headings), never the PDF. Instruction text can be corrected
 * by the user, but the source lines from the PDF stay attached for comparison.
 */
import { computeAppliesTo } from '../model/guide';
import { uid } from '../model/helpers';
import type { Instruction, Pattern, ParseWarning } from '../model/types';
import { detectTrackers, flagUnmodelledSimultaneous, sizeMismatchReasons } from './detect';
import { groupHeadings, splitAtSentences } from './parse';

const clone = <T,>(x: T): T => structuredClone(x);

export function splitInstruction(p: Pattern, id: string): Pattern {
  const out = clone(p);
  const idx = out.instructions.findIndex((i) => i.id === id);
  const ins = out.instructions[idx];
  if (!ins) return out;
  const parts = splitAtSentences(ins.text);
  if (parts.length < 2) return out;
  const repl: Instruction[] = parts.map((t, k) => ({
    ...clone(ins),
    id: k === 0 ? ins.id : `i-${uid().slice(0, 8)}`,
    text: t,
    review: undefined,
    ignoredSuggestions: undefined,
  }));
  out.instructions.splice(idx, 1, ...repl);
  return out;
}

export function mergeWithNext(p: Pattern, id: string): Pattern {
  const out = clone(p);
  const idx = out.instructions.findIndex((i) => i.id === id);
  const a = out.instructions[idx];
  const b = out.instructions[idx + 1];
  if (!a || !b || b.kind === 'tracker' || a.kind === 'tracker' || a.sectionId !== b.sectionId) return out;
  a.text = `${a.text} ${b.text}`;
  a.source.lines = [...a.source.lines, ...b.source.lines];
  a.source.imageIds = [...new Set([...a.source.imageIds, ...b.source.imageIds])];
  out.instructions.splice(idx + 1, 1);
  return out;
}

export function editText(p: Pattern, id: string, text: string): Pattern {
  const out = clone(p);
  const i = out.instructions.find((x) => x.id === id);
  if (i) i.text = text;
  return out;
}

export function setKind(p: Pattern, id: string, kind: 'action' | 'info'): Pattern {
  const out = clone(p);
  const i = out.instructions.find((x) => x.id === id);
  if (i && i.kind !== 'tracker' && i.kind !== 'stitch-pattern') i.kind = kind;
  return out;
}

/** Start a new section so that `id` becomes its first instruction. */
export function startSectionHere(p: Pattern, id: string, title: string, level: 1 | 2): Pattern {
  const out = clone(p);
  const idx = out.instructions.findIndex((i) => i.id === id);
  const ins = out.instructions[idx];
  if (!ins) return out;
  const oldSec = out.sections.find((s) => s.id === ins.sectionId)!;
  const secIdx = out.sections.indexOf(oldSec);
  const parent = level === 2 ? (oldSec.level === 1 ? oldSec : out.sections.find((s) => s.id === oldSec.parentId)) : undefined;
  const sec = { id: `s-${uid().slice(0, 8)}`, title, level, parentId: parent?.id, page: ins.source.page };
  // sections after this instruction's section keep order; instructions from idx..end-of-oldSec move
  const lastInOld = out.instructions.reduce((acc, i, k) => (i.sectionId === oldSec.id ? k : acc), idx);
  for (let k = idx; k <= lastInOld; k++) if (out.instructions[k].sectionId === oldSec.id) out.instructions[k].sectionId = sec.id;
  out.sections.splice(secIdx + 1, 0, sec);
  return out;
}

export function renameSection(p: Pattern, id: string, title: string): Pattern {
  const out = clone(p);
  const s = out.sections.find((x) => x.id === id);
  if (s) s.title = title;
  return out;
}

export function setSectionLevel(p: Pattern, id: string, level: 1 | 2): Pattern {
  const out = clone(p);
  const i = out.sections.findIndex((x) => x.id === id);
  const s = out.sections[i];
  if (!s) return out;
  s.level = level;
  s.parentId = undefined;
  if (level === 2) {
    for (let k = i - 1; k >= 0; k--) if (out.sections[k].level === 1) { s.parentId = out.sections[k].id; break; }
    if (!s.parentId) s.level = 1;
  }
  return out;
}

/** Remove a heading; its instructions join the previous section. */
export function removeSection(p: Pattern, id: string): Pattern {
  const out = clone(p);
  const i = out.sections.findIndex((x) => x.id === id);
  if (i <= 0) return out;
  const into = out.sections[i - 1];
  for (const ins of out.instructions) if (ins.sectionId === id) ins.sectionId = into.id;
  for (const s of out.sections) if (s.parentId === id) s.parentId = into.level === 1 ? into.id : into.parentId;
  out.sections.splice(i, 1);
  return out;
}

export function ignoreSuggestion(p: Pattern, id: string, evidence: string, ignore: boolean): Pattern {
  const out = clone(p);
  const i = out.instructions.find((x) => x.id === id);
  if (!i) return out;
  const set = new Set(i.ignoredSuggestions ?? []);
  if (ignore) set.add(evidence);
  else set.delete(evidence);
  i.ignoredSuggestions = [...set];
  return out;
}

/** Re-derive everything that depends on structure/text/sizes: trackers and review flags. */
export function finalizePattern(p: Pattern): Pattern {
  const out = clone(p);
  out.instructions = out.instructions.filter((i) => i.kind !== 'tracker');
  out.trackers = [];
  groupHeadings(out.sections, out.instructions);
  const sizeCount = out.sizes.length;
  const warnings: ParseWarning[] = out.parse.warnings.filter((w) => w.level === 'info' && !w.instructionId);
  let n = 0;
  const warn = (message: string, extra: Partial<ParseWarning> = {}) =>
    warnings.push({ id: `w${++n}`, level: 'needs-review', message, ...extra });
  if (!sizeCount) warn('No size list found. Add sizes in the review screen.');
  if (!out.gauge.raw) warn('No gauge found.');
  for (const ins of out.instructions) {
    ins.review = sizeMismatchReasons(ins.text, sizeCount, ins.appliesTo?.length);
    if (!ins.review.length) ins.review = undefined;
    else warn(ins.review.join(' '), { instructionId: ins.id, page: ins.source.page });
  }
  computeAppliesTo(out.sections, out.sizes);
  const { trackers } = detectTrackers(out.sections, out.instructions, out.stitchPatterns, out.sizes);
  out.trackers = trackers;
  for (const t of trackers) for (const r of t.review) warn(`${t.title}: ${r}`);
  for (const w of flagUnmodelledSimultaneous(out.instructions, trackers)) warn(w.message, { instructionId: w.id, page: w.page });
  out.parse.warnings = warnings;
  return out;
}
