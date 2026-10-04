/**
 * Builds the guided-knitting model for a project: one pass over the visible instructions that
 * carries context forward (flat/round, stitches on the needle, band width, last cast-on) and decides
 * which instructions are handled by a combined row guide instead of being separate steps.
 */
import { guideCtxOf } from '../model/helpers';
import { guideInstruction } from '../model/guide';
import { DEFAULT_PREFS, type Instruction, type KnitPrefs, type Pattern, type Project, type TrackerSpec } from '../model/types';
import { buildYokePlan, findMeasuredPlans, planRow, summarize, type MeasuredPlan, type PlannedRow, type PlanItem, type YokePlan } from './plan';
import { constructionText, translate, type Construction, type TCtx, type TStep, type Translation } from './translate';

export type GuidanceKind = 'steps' | 'yoke' | 'measured' | 'legacy' | 'info' | 'covered';

export interface Guidance {
  ins: Instruction;
  kind: GuidanceKind;
  title: string;
  tr?: Translation;
  plan?: YokePlan;
  spec?: TrackerSpec;
  measured?: MeasuredPlan;
  /** decrease/increase round steps for a measured plan */
  eventSteps?: TStep[];
  construction?: Construction;
  stitchesBefore?: number;
  stitchesAfter?: number;
  /** my own interpretation replaced the unsafe translation */
  override?: string[];
  review: boolean;
}

export interface GuidanceModel {
  list: Guidance[];
  byId: Map<string, Guidance>;
  covered: Set<string>;
}

const cache = new WeakMap<Pattern, Map<string, GuidanceModel>>();

const ROUND_START = /^(?:(?:decrease |increase |plain |short )?(?:rows?|rounds?)(?: \d+)?(?: ?\([^)]*\))?\s*:|work \d+ (?:rows?|rounds?) (?:even|in pattern|plain)|next row)/i;
const ROUNDISH = /^(?:(?:decrease |increase |plain |short )?(?:rows?|rounds?)(?: \d+)?(?: ?\([^)]*\))?\s*:|work \d+ (?:rows?|rounds?) (?:even|in pattern|plain)|work these \d+ |work (?:short )?(?:rows?|rounds?) \d+\s*[-–]\s*\d+ |repeat (?:these|rows?|rounds?) |\[\d+[^\]]*\])/i;
const REPEAT_STMT = /(?:a total of \d+|(?:work|repeat) (?:these \d+ |(?:short )?(?:rows?|rounds?) \d+\s*[-–]\s*\d+ )(?:rows?|rounds?)? ?until (?:the )?[a-z ]+ measures)/i;

export const prefsOf = (p: Pick<Project, 'prefs'>): KnitPrefs => ({ ...DEFAULT_PREFS, ...(p.prefs ?? {}) });

export function buildModel(pattern: Pattern, project: Project): GuidanceModel {
  const key = JSON.stringify([project.size, project.sizeOverrides ?? {}, prefsOf(project), project.knit?.guidanceOverrides ?? {}]);
  let m = cache.get(pattern);
  if (!m) cache.set(pattern, (m = new Map()));
  const hit = m.get(key);
  if (hit) return hit;
  const built = compute(pattern, project);
  if (m.size > 8) m.clear();
  m.set(key, built);
  return built;
}

function compute(pattern: Pattern, project: Project): GuidanceModel {
  const gctx = guideCtxOf(pattern, project);
  const prefs = prefsOf(project);
  const titleOf = (ins: Instruction) => pattern.sections.find((s) => s.id === ins.sectionId)?.title ?? '';
  const clean = (t: string) => t.replace(/\s*\(.*?\)\s*$/, '').replace(/[:.]$/, '').trim();

  const guided = new Map<string, string>();
  const items: PlanItem[] = [];
  const visible: Instruction[] = [];
  for (const ins of pattern.instructions) {
    if (ins.kind === 'tracker') {
      visible.push(ins);
      continue;
    }
    const g = guideInstruction(ins, gctx);
    if (g.hidden) continue;
    // unresolved size lists never reach the translator as numbers: they become a review marker
    const safe = g.parts.map((p) => (p.type === 'text' ? p.text : '⟦size value⟧')).join('');
    guided.set(ins.id, safe);
    visible.push(ins);
    if (ins.kind !== 'stitch-pattern') items.push({ id: ins.id, text: safe.replace(/\s+/g, ' '), section: titleOf(ins) });
  }

  const yoke = buildYokePlan(items.filter((i) => !i.text.includes('⟦')));
  const measuredPlans = findMeasuredPlans(items);
  const covered = new Set<string>();
  yoke?.sourceIds.forEach((id) => covered.add(id));
  for (const mp of measuredPlans) mp.coveredIds.forEach((id) => covered.add(id));
  const yokeSpec = yoke ? pattern.trackers.find((t) => t.sourceInstructionIds.some((id) => yoke.sourceIds.includes(id))) : undefined;
  // other legacy trackers whose sources are all handled by the yoke plan
  const yokeTracker = yokeSpec ? pattern.instructions.find((i) => i.trackerId === yokeSpec.id) : undefined;
  if (yoke) {
    for (const t of pattern.trackers) {
      if (t.id !== yokeSpec?.id && t.sourceInstructionIds.every((id) => yoke.sourceIds.includes(id) || !guided.has(id))) {
        const ti = pattern.instructions.find((i) => i.trackerId === t.id);
        if (ti) covered.add(ti.id);
      }
    }
  }

  const tipItem = items.find((i) => /^(?:start|begin) \d+ stitches before the marker-?thread/i.test(i.text));

  // everything printed before the first cast-on (needles, notions, sizing notes) is background, not a step
  const startAt = visible.findIndex((i) => i.kind === 'action' && /\bcast(?:ing)? on\b/i.test(guided.get(i.id) ?? ''));
  const background = new Set(startAt > 0 ? visible.slice(0, startAt).map((i) => i.id) : []);
  const list: Guidance[] = [];
  const joined = new Set<string>();
  const ctx: TCtx = { prefs, sectionTitle: '' };
  for (const ins of visible) {
    const title = titleOf(ins);
    ctx.sectionTitle = title;
    const base = { ins, title, review: false } as Guidance;
    if (ins.kind === 'tracker') {
      const spec = pattern.trackers.find((t) => t.id === ins.trackerId);
      if (covered.has(ins.id)) {
        list.push({ ...base, kind: 'covered' });
      } else if (yoke && yokeTracker && ins.id === yokeTracker.id) {
        const sim = summarize(yoke, 1);
        list.push({ ...base, kind: 'yoke', plan: yoke, spec, construction: 'flat', stitchesBefore: yoke.startStitches, stitchesAfter: yoke.finalStitches ?? sim.finalStitches, review: yoke.review.length > 0 });
        ctx.stitches = yoke.finalStitches ?? sim.finalStitches;
        ctx.construction = 'flat';
      } else {
        list.push({ ...base, kind: 'legacy', spec, construction: ctx.construction, stitchesBefore: ctx.stitches, review: !!spec?.review.length });
      }
      continue;
    }
    if (covered.has(ins.id) || joined.has(ins.id)) {
      list.push({ ...base, kind: 'covered' });
      if (joined.has(ins.id)) covered.add(ins.id);
      continue;
    }
    // Rounds that are repeated ("Round 1 … Round 2 … work rounds 1-2 a total of 7 times", "repeat rows 1-2 until
    // the scarf measures 160 cm") are worked together, even when the designer's paragraphs were split apart.
    const here = visible.indexOf(ins);
    let text = guided.get(ins.id) ?? '';
    const chain: Instruction[] = [];
    if (ins.kind === 'stitch-pattern' || ROUND_START.test(text)) {
      for (let k = here + 1; k < visible.length && visible[k].sectionId === ins.sectionId && ROUNDISH.test(guided.get(visible[k].id) ?? ''); k++) chain.push(visible[k]);
    }
    const chainText = [text, ...chain.map((c) => guided.get(c.id) ?? '')].join(' ');
    const repeats = REPEAT_STMT.test(chainText);
    if (repeats) {
      text = chainText;
      for (const c of chain) joined.add(c.id);
    }
    if (ins.kind === 'info' || (ins.kind === 'stitch-pattern' && !repeats) || /overview/i.test(title) || /^(abbreviations?|glossary|credits?|popular patterns|tin can knits|about|copyright)/i.test(title) || background.has(ins.id)) {
      list.push({ ...base, kind: 'info' });
      continue;
    }
    const mp = measuredPlans.find((p) => p.anchorId === ins.id);
    if (mp) {
      ctx.construction = 'round';
      const tip = tipItem ? translate(tipItem.text, { ...ctx }).steps : [];
      const end = mp.end ?? (ctx.stitches !== undefined ? ctx.stitches - mp.delta * mp.times : undefined);
      list.push({ ...base, kind: 'measured', measured: mp, eventSteps: tip, construction: 'round', stitchesBefore: ctx.stitches, stitchesAfter: end, review: tip.length === 0 });
      if (end !== undefined) ctx.stitches = end;
      continue;
    }
    // a piece that is cast on and then finished "after a row from the wrong side" is worked flat
    const nxt = visible[visible.indexOf(ins) + 1];
    const hintFlat = !ctx.construction && nxt && nxt.sectionId === ins.sectionId && /wrong side|right side|back and forth/i.test(guided.get(nxt.id) ?? '');
    const tr = translate(text, { ...ctx, construction: hintFlat ? 'flat' : ctx.construction });
    const ov = project.knit?.guidanceOverrides?.[ins.id];
    list.push({
      ...base,
      kind: 'steps',
      tr,
      construction: tr.construction ?? ctx.construction,
      stitchesBefore: ctx.stitches,
      stitchesAfter: tr.next.stitches ?? ctx.stitches,
      override: ov?.steps,
      review: tr.review && !ov,
    });
    Object.assign(ctx, tr.next);
    if (tr.construction) ctx.construction = tr.construction;
  }
  void clean;
  return { list, byId: new Map(list.map((g) => [g.ins.id, g])), covered };
}

/* ---------------------------------------------------------- knit state keys */

export const rowKey = (trackerId: string, row: number) => `${trackerId}:r${row}`;
export const measuredKey = (insId: string) => `${insId}:m`;
export const bhKey = (trackerId: string) => `${trackerId}:bh`;

export function yokeRow(g: Guidance, project: Project): PlannedRow | undefined {
  if (g.kind !== 'yoke' || !g.plan || !g.spec) return undefined;
  const ts = project.trackers[g.spec.id];
  const row = ts?.row ?? 1;
  const bh = project.knit?.measured?.[bhKey(g.spec.id)] ?? { done: 0, due: false };
  return planRow(g.plan, row, { vFirst: ts?.firstOverrides?.vneck ?? 1, bh });
}

export const sideLabel = (s?: 'RS' | 'WS') => (s === 'RS' ? 'RIGHT SIDE' : s === 'WS' ? 'WRONG SIDE' : '');

export const phasePos = (project: Project, insId: string) => project.knit?.phase?.[insId] ?? { part: 0, rep: 0, idx: 0 };

/** The steps on screen for a card that is made of parts, and where in them the knitter is. */
export function currentPart(g: Guidance, project: Project) {
  const parts = g.tr?.parts;
  if (!parts?.length) return undefined;
  const pos = phasePos(project, g.ins.id);
  const part = parts[Math.min(pos.part, parts.length - 1)];
  return { parts, pos, part, last: pos.part >= parts.length - 1 };
}

/** Key under which the ticked steps of the current card are saved. */
export function stepsKeyFor(g: Guidance, project: Project): string {
  const cp = currentPart(g, project);
  if (cp) return cp.part.kind === 'repeat' ? `${g.ins.id}:p${cp.pos.part}:r${cp.pos.rep}:i${cp.pos.idx}` : `${g.ins.id}:p${cp.pos.part}`;
  if (g.kind === 'yoke' && g.spec) return rowKey(g.spec.id, project.trackers[g.spec.id]?.row ?? 1);
  if (g.kind === 'measured') return `${g.ins.id}:e${project.knit?.measured?.[measuredKey(g.ins.id)]?.done ?? 0}`;
  return g.ins.id;
}

/** The guidance card for the knitter's current place: covered/info instructions resolve to the next real card. */
export function resolveCurrent(model: GuidanceModel, currentId?: string): Guidance | undefined {
  const idx = model.list.findIndex((g) => g.ins.id === currentId);
  const real = (g: Guidance) => g.kind !== 'covered' && g.kind !== 'info';
  if (idx >= 0 && real(model.list[idx])) return model.list[idx];
  const start = Math.max(0, idx);
  return model.list.slice(start).find(real) ?? model.list.slice(0, start).reverse().find(real);
}

/** Plain description of where the knitter is: used for CONTINUE KNITTING and Quick Stop. */
export function describeKnit(pattern: Pattern, project: Project): { headline: string[]; nextAction?: string; tracking: string[]; stitches?: number } | undefined {
  if (!project.progress.currentInstructionId) return undefined;
  const model = buildModel(pattern, project);
  const g = resolveCurrent(model, project.progress.currentInstructionId);
  if (!g) return undefined;
  const prefs = prefsOf(project);
  const done = project.knit?.stepsDone?.[stepsKeyFor(g, project)] ?? [];
  const firstOpen = (steps: TStep[]) => steps.find((_, i) => !done.includes(i))?.text;
  const headline: string[] = [g.title.replace(/[:.]$/, '')];
  const tracking: string[] = [];
  let next: string | undefined;
  let stitches = g.stitchesBefore;
  if (g.kind === 'yoke') {
    const r = yokeRow(g, project);
    if (r) {
      headline.push(`Row ${r.row}`, sideLabel(r.side), 'Working flat');
      next = firstOpen(r.steps);
      stitches = r.before;
      for (const t of r.tracking) tracking.push(`${t.label}: ${t.done} of ${t.total}`);
    }
  } else {
    const c = constructionText(g.construction, prefs);
    if (c) headline.push(c.title.charAt(0) + c.title.slice(1).toLowerCase());
    const cp = currentPart(g, project);
    if (cp?.part.kind === 'repeat') {
      const b = cp.part.block;
      headline.push(`${b.unit === 'row' ? 'Row' : 'Round'} ${cp.pos.idx + 1} of ${b.rounds.length}`);
      tracking.push(b.times !== undefined ? `Repeat ${cp.pos.rep + 1} of ${b.times}` : `Repeat ${cp.pos.rep + 1}`);
    }
    const steps = g.override?.map((t) => ({ text: t, tech: [] as string[] })) ?? (cp ? (cp.part.kind === 'repeat' ? cp.part.block.rounds[cp.pos.idx]?.steps : cp.part.steps) : g.tr?.steps) ?? g.eventSteps ?? [];
    next = firstOpen(steps as TStep[]);
    if (g.kind === 'measured' && g.measured) {
      const ms = project.knit?.measured?.[measuredKey(g.ins.id)] ?? { done: 0, due: false };
      tracking.push(`Decreases completed: ${ms.done} of ${g.measured.times}`);
    }
  }
  return { headline: headline.filter(Boolean), nextAction: next, tracking, stitches };
}
