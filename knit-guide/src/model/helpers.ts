import { guideInstruction, type GuideCtx } from './guide';
import type { Counter, Instruction, Pattern, Project, Note } from './types';

/** UUID that also works in insecure contexts (http://192.168.x.x), where crypto.randomUUID is missing. */
export function uid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export const now = () => Date.now();

export const isActionable = (i: Instruction) => i.kind === 'action' || i.kind === 'tracker';

export function sizeIndexOf(pattern: Pattern, project: Pick<Project, 'size'>): number {
  return pattern.sizes.indexOf(project.size);
}

export const guideCtxOf = (pattern: Pattern, project: Pick<Project, 'size' | 'sizeOverrides'>): GuideCtx => ({
  pattern,
  size: project.size,
  overrides: project.sizeOverrides ?? {},
});

/** Instructions that exist in the guide for this project's size (others are hidden). */
export const visibleInstructions = (pattern: Pattern, project: Pick<Project, 'size' | 'sizeOverrides'>) => {
  const ctx = guideCtxOf(pattern, project);
  return pattern.instructions.filter((i) => i.kind === 'tracker' || !guideInstruction(i, ctx).hidden);
};

/** Has real knitting happened? Used to warn before a size change. */
export const hasProgress = (p: Project) =>
  p.status !== 'not-started' ||
  p.progress.completed.length > 0 ||
  p.counters.length > 0 ||
  p.stitchCounters.length > 0 ||
  Object.keys(p.trackers).length > 0 ||
  !!p.progress.currentInstructionId;

export function progressFraction(pattern: Pattern, project: Project): number {
  const vis = visibleInstructions(pattern, project);
  const total = vis.filter(isActionable).length;
  if (!total) return 0;
  const done = project.progress.completed.filter((id) => vis.some((i) => i.id === id && isActionable(i))).length;
  return Math.min(1, done / total);
}

export function findInstruction(pattern: Pattern, id?: string) {
  return id ? pattern.instructions.find((i) => i.id === id) : undefined;
}

export function sectionTitle(pattern: Pattern, id?: string) {
  return pattern.sections.find((s) => s.id === id)?.title ?? '';
}

export function nextActionable(pattern: Pattern, afterId?: string, project?: Pick<Project, 'size' | 'sizeOverrides'>): Instruction | undefined {
  const list = project ? visibleInstructions(pattern, project) : pattern.instructions;
  const at = afterId ? pattern.instructions.findIndex((i) => i.id === afterId) : -1;
  return pattern.instructions.slice(at + 1).filter((i) => list.includes(i)).find(isActionable);
}

/** Newest note relevant to where the knitter is: stop note, then instruction, section, project. */
export function relevantNote(project: Project, pattern: Pattern): Note | undefined {
  const newest = (ns: Note[]) => [...ns].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const cur = findInstruction(pattern, project.progress.currentInstructionId);
  const stop = newest(project.notes.filter((n) => n.scope.type === 'stop'));
  if (stop) return stop;
  return (
    newest(project.notes.filter((n) => n.scope.type === 'instruction' && n.scope.instructionId === cur?.id)) ??
    newest(project.notes.filter((n) => n.scope.type === 'section' && n.scope.sectionId === cur?.sectionId)) ??
    newest(project.notes.filter((n) => n.scope.type === 'project'))
  );
}

export function counterText(c: Counter): string {
  const unit = c.kind === 'rows' ? 'Row' : c.kind === 'rounds' ? 'Round' : c.kind === 'times' ? 'Repeat' : c.kind === 'stitches' ? 'Stitches' : c.label;
  return `${unit} ${c.value}${c.target ? ` / ${c.target}` : ''}`;
}

export function formatWhen(ts?: number): string {
  if (!ts) return 'Never';
  const d = new Date(ts);
  const n = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, n)) return `Today ${time}`;
  const y = new Date(n);
  y.setDate(n.getDate() - 1);
  if (sameDay(d, y)) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === n.getFullYear() ? undefined : 'numeric' })} ${time}`;
}

export const isTextSource = (p: Pattern) => p.sourceType === 'text';
export const sourceLabel = (p: Pattern) => (isTextSource(p) ? 'ORIGINAL TEXT' : 'ORIGINAL PDF');

/** Review notes that still belong in the guide (size problems are handled by the size-value review instead). */
export const guideNotes = (ins: Instruction) => (ins.review ?? []).filter((r) => !/numbers but the pattern has/.test(r));
