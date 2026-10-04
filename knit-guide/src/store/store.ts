/**
 * App state. Every change to a project is written to IndexedDB immediately
 * (one write per change, serialised per project) so nothing is lost if Safari is closed.
 */
import { create } from 'zustand';
import { clampTotal } from '../engine/stitch';
import { findInstruction, isActionable, nextActionable, now, uid } from '../model/helpers';
import { buildModel, bhKey, describeKnit, measuredKey, yokeRow } from '../guidance/flow';
import type {
  Counter,
  CounterKind,
  Modification,
  Note,
  NoteScope,
  Pattern,
  Project,
  ProjectSetup,
  StopSnapshot,
  KnitPrefs,
  KnitState,
} from '../model/types';
import { createRepo, type Repo } from '../storage/db';

export const repo: Repo = createRepo();

interface State {
  loaded: boolean;
  patterns: Record<string, Pattern>;
  projects: Record<string, Project>;
  /** bumped on every persisted write; lets the UI show "saved" */
  lastSavedAt: number;
}

export const useStore = create<State>(() => ({ loaded: false, patterns: {}, projects: {}, lastSavedAt: 0 }));

/**
 * Durability: IndexedDB writes are asynchronous, so a tap immediately followed by closing Safari could
 * be lost. Every change is therefore ALSO written synchronously to localStorage (a write-ahead copy)
 * before the IndexedDB write starts, and removed once IndexedDB confirms it. On startup any surviving
 * write-ahead copy that is newer than the stored project is restored.
 */
const WAL = 'kg:wal:';
function walWrite(p: Project) {
  try { localStorage.setItem(WAL + p.id, JSON.stringify(p)); } catch { /* storage full or blocked: IndexedDB still gets the write */ }
}
function walClear(p: Project) {
  try {
    const raw = localStorage.getItem(WAL + p.id);
    if (raw && (JSON.parse(raw) as Project).rev === p.rev) localStorage.removeItem(WAL + p.id);
  } catch { /* ignore */ }
}
function walRead(): Project[] {
  const out: Project[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(WAL)) out.push(JSON.parse(localStorage.getItem(k)!) as Project);
    }
  } catch { /* ignore */ }
  return out;
}

const dirty = new Map<string, Project>();
const writers = new Map<string, Promise<void>>();
function persist(project: Project): Promise<void> {
  walWrite(project);
  dirty.set(project.id, project); // only the newest state per project needs writing
  const running = writers.get(project.id);
  if (running) return running;
  const run = (async () => {
    while (dirty.has(project.id)) {
      const p = dirty.get(project.id)!;
      dirty.delete(project.id);
      try {
        await repo.putProject(p);
        walClear(p);
      } catch (e) {
        console.error('save failed (write-ahead copy kept)', e);
      }
    }
    writers.delete(project.id);
    useStore.setState({ lastSavedAt: Date.now() });
  })();
  writers.set(project.id, run);
  return run;
}

/** Wait for pending writes (used by tests and on pagehide). */
export async function flushWrites() {
  await Promise.all([...writers.values()]);
}

export async function initStore() {
  try {
    const { patterns, projects } = await repo.loadAll();
    // replay write-ahead copies that never reached IndexedDB (e.g. Safari closed right after a tap)
    for (const w of walRead()) {
      const i = projects.findIndex((p) => p.id === w.id);
      if (i === -1 || (w.rev ?? 0) > (projects[i].rev ?? 0) || w.updatedAt > projects[i].updatedAt) {
        if (i === -1) projects.push(w);
        else projects[i] = w;
        void persist(w);
      } else walClear(w);
    }
    useStore.setState({
      loaded: true,
      patterns: Object.fromEntries(patterns.map((p) => [p.id, p])),
      projects: Object.fromEntries(projects.map((p) => [p.id, p])),
    });
  } catch (e) {
    console.error(e);
    useStore.setState({ loaded: true });
  }
}

function mutate(id: string, fn: (p: Project) => void, touch = true): Project | undefined {
  const cur = useStore.getState().projects[id];
  if (!cur) return;
  const next = structuredClone(cur);
  fn(next);
  next.updatedAt = now();
  next.rev = (cur.rev ?? 0) + 1;
  if (touch) {
    next.lastWorkedAt = next.updatedAt;
    if (next.status === 'not-started') next.status = 'active';
  }
  useStore.setState((s) => ({ projects: { ...s.projects, [id]: next } }));
  persist(next);
  return next;
}

/* ---------------------------------------------------------------- projects */

export interface NewProjectInput {
  pattern: Pattern;
  fileBlob: Blob;
  imageBlobs: Record<string, Blob>;
  photoBlob?: Blob;
  name: string;
  size: string;
  sizeOverrides?: Record<string, string>;
  setup: ProjectSetup;
  modification?: string;
}

export async function createProject(input: NewProjectInput): Promise<Project> {
  const { pattern } = input;
  await repo.putFile(pattern.fileId, input.fileBlob);
  for (const [id, blob] of Object.entries(input.imageBlobs)) await repo.putFile(id, blob);
  let photoId: string | undefined;
  if (input.photoBlob) {
    photoId = `photo-${uid()}`;
    await repo.putFile(photoId, input.photoBlob);
  }
  pattern.updatedAt = now();
  await repo.putPattern(pattern);

  // open the section where knitting starts (first cast on), else the first instruction
  const firstAction = pattern.instructions.find((i) => i.kind === 'action' && /\bcast(ing)?\s+on\b/i.test(i.text)) ?? pattern.instructions.find(isActionable);
  const t = now();
  const project: Project = {
    id: uid(),
    patternId: pattern.id,
    createdAt: t,
    updatedAt: t,
    rev: 1,
    name: input.name,
    photoId,
    status: 'not-started',
    size: input.size,
    sizeOverrides: input.sizeOverrides ?? {},
    setup: input.setup,
    modifications: input.modification
      ? [{ id: uid(), instructionId: null, text: input.modification, createdAt: t, updatedAt: t }]
      : [],
    notes: [],
    counters: [],
    stitchCounters: [],
    trackers: {},
    progress: {
      completed: [],
      expanded: firstAction ? [firstAction.sectionId, pattern.sections.find((s) => s.id === firstAction.sectionId)?.parentId ?? ''].filter(Boolean) : [],
      pdfPage: 1,
    },
  };
  useStore.setState((s) => ({
    patterns: { ...s.patterns, [pattern.id]: pattern },
    projects: { ...s.projects, [project.id]: project },
  }));
  await persist(project);
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* best effort: asks the browser not to evict our data */
  }
  return project;
}

export const renameProject = (id: string, name: string) => mutate(id, (p) => void (p.name = name), false);
export const archiveProject = (id: string, archived: boolean) => mutate(id, (p) => void (p.archived = archived), false);
export const setStatus = (id: string, status: Project['status']) => mutate(id, (p) => void (p.status = status), false);
export const updateSetup = (id: string, patch: Partial<ProjectSetup>) =>
  mutate(id, (p) => void Object.assign(p.setup, patch), false);
/** Changing size invalidates hand-confirmed size values, so they are cleared with it. */
export const setSize = (id: string, size: string) =>
  mutate(id, (p) => {
    if (p.size !== size) p.sizeOverrides = {};
    p.size = size;
  }, false);

export const setOverride = (id: string, key: string, value: string | null) =>
  mutate(id, (p) => {
    p.sizeOverrides = { ...(p.sizeOverrides ?? {}) };
    if (value === null || value === '') delete p.sizeOverrides[key];
    else p.sizeOverrides[key] = value.trim();
  }, false);

export async function setPhoto(id: string, blob: Blob | null) {
  const cur = useStore.getState().projects[id];
  if (!cur) return;
  let photoId: string | undefined;
  if (blob) {
    photoId = `photo-${uid()}`;
    await repo.putFile(photoId, blob);
  }
  if (cur.photoId) await repo.deleteFile(cur.photoId);
  mutate(id, (p) => void (p.photoId = photoId), false);
}

export async function deleteProject(id: string) {
  const s = useStore.getState();
  const proj = s.projects[id];
  if (!proj) return;
  await flushWrites();
  await repo.deleteProject(id);
  if (proj.photoId) await repo.deleteFile(proj.photoId);
  const pat = s.patterns[proj.patternId];
  const stillUsed = Object.values(s.projects).some((p) => p.id !== id && p.patternId === proj.patternId);
  if (pat && !stillUsed) {
    await repo.deletePattern(pat.id);
    await repo.deleteFile(pat.fileId);
    for (const im of pat.images) if (im.fileId) await repo.deleteFile(im.fileId);
  }
  useStore.setState((st) => {
    const projects = { ...st.projects };
    delete projects[id];
    const patterns = { ...st.patterns };
    if (!stillUsed) delete patterns[proj.patternId];
    return { projects, patterns };
  });
}

/* ------------------------------------------------------------ place keeping */

export function knitFromHere(id: string, instructionId: string) {
  const proj = useStore.getState().projects[id];
  const pat = proj && useStore.getState().patterns[proj.patternId];
  const ins = pat && findInstruction(pat, instructionId);
  if (!pat || !ins) return;
  mutate(id, (p) => {
    p.progress.currentInstructionId = ins.id;
    p.progress.currentSectionId = ins.sectionId;
    p.progress.currentSetAt = now();
    const sec = pat.sections.find((s) => s.id === ins.sectionId);
    for (const sid of [sec?.id, sec?.parentId]) if (sid && !p.progress.expanded.includes(sid)) p.progress.expanded.push(sid);
  });
}

export const toggleComplete = (id: string, instructionId: string) =>
  mutate(id, (p) => {
    const i = p.progress.completed.indexOf(instructionId);
    if (i >= 0) p.progress.completed.splice(i, 1);
    else p.progress.completed.push(instructionId);
  });

/** Next actionable instruction that is not just a schedule already handled by a combined row guide. */
export function nextKnitStep(pat: Pattern, proj: Project, afterId: string) {
  const covered = buildModel(pat, proj).covered;
  let cur = nextActionable(pat, afterId, proj);
  while (cur && covered.has(cur.id)) cur = nextActionable(pat, cur.id, proj);
  return cur;
}

/** Mark current done and move "knit from here" to the next actionable instruction. */
export function finishAndAdvance(id: string, instructionId: string) {
  const proj = useStore.getState().projects[id];
  const pat = proj && useStore.getState().patterns[proj.patternId];
  if (!pat) return;
  const next = nextKnitStep(pat, proj, instructionId);
  mutate(id, (p) => {
    if (!p.progress.completed.includes(instructionId)) p.progress.completed.push(instructionId);
    if (next) {
      p.progress.currentInstructionId = next.id;
      p.progress.currentSectionId = next.sectionId;
      p.progress.currentSetAt = now();
      const sec = pat.sections.find((s) => s.id === next.sectionId);
      for (const sid of [sec?.id, sec?.parentId]) if (sid && !p.progress.expanded.includes(sid)) p.progress.expanded.push(sid);
    } else p.status = 'finished';
  });
  return next;
}

export const setExpanded = (id: string, sectionId: string, open: boolean) =>
  mutate(
    id,
    (p) => {
      const has = p.progress.expanded.includes(sectionId);
      if (open && !has) p.progress.expanded.push(sectionId);
      if (!open && has) p.progress.expanded = p.progress.expanded.filter((x) => x !== sectionId);
    },
    false,
  );

export const setSourceScroll = (id: string, frac: number) =>
  mutate(id, (p) => void (p.progress.sourceScroll = frac), false);

export const setPdfPage = (id: string, page: number) =>
  mutate(id, (p) => void (p.progress.pdfPage = page), false);

/* ------------------------------------------------------------------- notes */

export function addNote(id: string, scope: NoteScope, text: string): Note | undefined {
  const note: Note = { id: uid(), scope, text, createdAt: now(), updatedAt: now() };
  mutate(id, (p) => void p.notes.push(note), false);
  return note;
}
export const editNote = (id: string, noteId: string, text: string) =>
  mutate(id, (p) => {
    const n = p.notes.find((x) => x.id === noteId);
    if (n) {
      n.text = text;
      n.updatedAt = now();
    }
  }, false);
export const deleteNote = (id: string, noteId: string) =>
  mutate(id, (p) => {
    p.notes = p.notes.filter((n) => n.id !== noteId);
    if (p.progress.lastStop?.noteId === noteId) p.progress.lastStop.noteId = undefined;
  }, false);

/* ------------------------------------------------------------ modifications */

export function addModification(id: string, instructionId: string | null, text: string) {
  const m: Modification = { id: uid(), instructionId, text, createdAt: now(), updatedAt: now() };
  mutate(id, (p) => void p.modifications.push(m), false);
}
export const editModification = (id: string, modId: string, text: string) =>
  mutate(id, (p) => {
    const m = p.modifications.find((x) => x.id === modId);
    if (m) {
      m.text = text;
      m.updatedAt = now();
    }
  }, false);
export const deleteModification = (id: string, modId: string) =>
  mutate(id, (p) => void (p.modifications = p.modifications.filter((m) => m.id !== modId)), false);

/* ---------------------------------------------------------------- counters */

export function addCounter(
  id: string,
  instructionId: string,
  kind: CounterKind,
  label: string,
  target?: number,
  autoAdvance = false,
): Counter {
  const c: Counter = { id: uid(), instructionId, kind, label, value: 0, target, autoAdvance, createdAt: now(), updatedAt: now() };
  mutate(id, (p) => void p.counters.push(c));
  return c;
}

export function bumpCounter(id: string, counterId: string, delta: number) {
  let advanced: string | undefined;
  mutate(id, (p) => {
    const c = p.counters.find((x) => x.id === counterId);
    if (!c) return;
    const before = c.value;
    c.value = Math.max(0, c.value + delta);
    c.updatedAt = now();
    if (c.autoAdvance && c.target && before < c.target && c.value >= c.target) advanced = c.instructionId;
  });
  if (advanced) finishAndAdvance(id, advanced);
}
export const setCounter = (id: string, counterId: string, patch: Partial<Pick<Counter, 'value' | 'target' | 'label' | 'autoAdvance' | 'kind'>>) =>
  mutate(id, (p) => {
    const c = p.counters.find((x) => x.id === counterId);
    if (c) {
      Object.assign(c, patch);
      c.updatedAt = now();
    }
  });
export const deleteCounter = (id: string, counterId: string) =>
  mutate(id, (p) => void (p.counters = p.counters.filter((c) => c.id !== counterId)), false);

export function addStitchCounter(id: string, instructionId: string, target: number, groupSize: number, label: string) {
  const sc = { id: uid(), instructionId, label, target, groupSize, total: 0, createdAt: now(), updatedAt: now() };
  mutate(id, (p) => void p.stitchCounters.push(sc));
  return sc;
}
export const bumpStitches = (id: string, scId: string, delta: number) =>
  mutate(id, (p) => {
    const sc = p.stitchCounters.find((x) => x.id === scId);
    if (sc) {
      sc.total = clampTotal(sc.total + delta);
      sc.updatedAt = now();
    }
  });
export const resetStitches = (id: string, scId: string) =>
  mutate(id, (p) => {
    const sc = p.stitchCounters.find((x) => x.id === scId);
    if (sc) {
      sc.total = 0;
      sc.updatedAt = now();
    }
  });
export const patchStitchCounter = (id: string, scId: string, patch: { target?: number; groupSize?: number; total?: number }) =>
  mutate(id, (p) => {
    const sc = p.stitchCounters.find((x) => x.id === scId);
    if (sc) {
      Object.assign(sc, patch);
      sc.updatedAt = now();
    }
  });
export const deleteStitchCounter = (id: string, scId: string) =>
  mutate(id, (p) => void (p.stitchCounters = p.stitchCounters.filter((c) => c.id !== scId)), false);

/* ---------------------------------------------------------------- trackers */

export function setTrackerRow(id: string, trackerId: string, row: number) {
  mutate(id, (p) => {
    const t = (p.trackers[trackerId] ??= { row: 1, firstOverrides: {} });
    t.row = Math.max(1, Math.round(row));
  });
}
export function setTrackerFirst(id: string, trackerId: string, intervalId: string, first: number) {
  mutate(id, (p) => {
    const t = (p.trackers[trackerId] ??= { row: 1, firstOverrides: {} });
    t.firstOverrides[intervalId] = first;
  }, false);
}
export function setTrackerLaceOffset(id: string, trackerId: string, offset: number) {
  mutate(id, (p) => {
    const t = (p.trackers[trackerId] ??= { row: 1, firstOverrides: {} });
    t.laceOffset = offset;
  }, false);
}

/* --------------------------------------------------------------- quick stop */

/** Saves a timestamped stopping point. The progress itself is already persisted; this freezes it. */
export function quickStop(id: string, note?: string): StopSnapshot | undefined {
  const proj = useStore.getState().projects[id];
  const pat = proj && useStore.getState().patterns[proj.patternId];
  if (!proj || !pat) return;
  const d = describeKnit(pat, proj);
  const snap: StopSnapshot = {
    at: now(),
    state: d ? { headline: d.headline, nextAction: d.nextAction, tracking: d.tracking, stitches: d.stitches } : undefined,
    sectionId: proj.progress.currentSectionId,
    instructionId: proj.progress.currentInstructionId,
    position: positionSummary(proj, pat),
  };
  if (note?.trim()) {
    const n = addNote(id, { type: 'stop' }, note.trim());
    snap.noteId = n?.id;
  }
  mutate(id, (p) => void (p.progress.lastStop = snap));
  return snap;
}

export function attachStopNote(id: string, text: string) {
  const proj = useStore.getState().projects[id];
  if (!proj?.progress.lastStop || !text.trim()) return;
  const n = addNote(id, { type: 'stop' }, text.trim());
  mutate(id, (p) => {
    if (p.progress.lastStop && n) p.progress.lastStop.noteId = n.id;
  }, false);
}

export function positionSummary(project: Project, pattern: Pattern): string | undefined {
  const ins = findInstruction(pattern, project.progress.currentInstructionId);
  if (!ins) return undefined;
  if (ins.kind === 'tracker' && ins.trackerId) {
    const spec = pattern.trackers.find((t) => t.id === ins.trackerId);
    const row = project.trackers[ins.trackerId]?.row ?? 1;
    return `${spec?.unit === 'round' ? 'Round' : 'Row'} ${row}`;
  }
  const c = project.counters.find((x) => x.instructionId === ins.id);
  if (c) return `${c.kind === 'rows' ? 'Row' : c.kind === 'rounds' ? 'Round' : c.label} ${c.value}${c.target ? ` / ${c.target}` : ''}`;
  const sc = project.stitchCounters.find((x) => x.instructionId === ins.id);
  if (sc) return `${sc.total} / ${sc.target} stitches`;
  return undefined;
}

/* ---------------------------------------------------------------- patterns */

/** Persist a corrected pattern (used by review after-the-fact editing, later). */
export async function savePattern(p: Pattern) {
  p.updatedAt = now();
  await repo.putPattern(p);
  useStore.setState((s) => ({ patterns: { ...s.patterns, [p.id]: p } }));
}

/** Flush pending writes when the page is hidden (Safari tab switch, lock, close). */
export function installLifecycleFlush() {
  const flush = () => void flushWrites();
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
  window.addEventListener('pagehide', flush);
}


/* -------------------------------------------------------------- knit mode */

const emptyKnit = (): KnitState => ({ stepsDone: {}, checkpoints: {}, measured: {}, guidanceOverrides: {}, measurements: {} });
const knitOf = (p: Project): KnitState => (p.knit = { ...emptyKnit(), ...(p.knit ?? {}) });

export const setPrefs = (id: string, patch: Partial<KnitPrefs>) =>
  mutate(id, (p) => void (p.prefs = { circular: true, smallCircumference: 'magic-loop', ...(p.prefs ?? {}), ...patch }), false);

export const tickStep = (id: string, key: string, index: number, on: boolean) =>
  mutate(id, (p) => {
    const k = knitOf(p);
    const cur = new Set(k.stepsDone[key] ?? []);
    if (on) cur.add(index);
    else cur.delete(index);
    k.stepsDone[key] = [...cur].sort((a, b) => a - b);
  });

export const saveCheckpoint = (id: string, key: string, expected: number, counted: number) =>
  mutate(id, (p) => {
    knitOf(p).checkpoints[key] = { expected, counted, verifiedAt: counted === expected ? now() : undefined };
  });

export const recordMeasurement = (id: string, key: string, cm: number | null) =>
  mutate(id, (p) => {
    const k = knitOf(p);
    if (cm === null) delete k.measurements[key];
    else k.measurements[key] = { cm, at: now() };
  });

export const saveGuidanceOverride = (id: string, insId: string, steps: string[] | null) =>
  mutate(id, (p) => {
    const k = knitOf(p);
    if (!steps || steps.length === 0) delete k.guidanceOverrides[insId];
    else k.guidanceOverrides[insId] = { steps, at: now() };
  }, false);

/** The knitter confirms the measurement for a buttonhole / measured event is reached. */
export const setMeasuredDue = (id: string, key: string, due: boolean) =>
  mutate(id, (p) => {
    const k = knitOf(p);
    const cur = k.measured[key] ?? { done: 0, due: false };
    k.measured[key] = { ...cur, due };
  });

/** ROW DONE for the combined yoke row: advances the row and every counter derived from it. */
export function yokeRowDone(id: string, insId: string) {
  const proj = useStore.getState().projects[id];
  const pat = proj && useStore.getState().patterns[proj.patternId];
  const g = pat && buildModel(pat, proj).byId.get(insId);
  if (!proj || !g || g.kind !== 'yoke' || !g.spec) return;
  const r = yokeRow(g, proj);
  if (!r) return;
  const spec = g.spec;
  mutate(id, (p) => {
    const k = knitOf(p);
    const t = (p.trackers[spec.id] ??= { row: 1, firstOverrides: {} });
    const bk = bhKey(spec.id);
    const bh = k.measured[bk] ?? { done: 0, due: false };
    if (r.buttonhole) k.measured[bk] = { done: bh.done + 1, due: false, justDone: true };
    else if (bh.justDone) k.measured[bk] = { ...bh, justDone: false };
    t.row = r.row + 1;
  });
}

export function yokeRowBack(id: string, insId: string) {
  const proj = useStore.getState().projects[id];
  const pat = proj && useStore.getState().patterns[proj.patternId];
  const g = pat && buildModel(pat, proj).byId.get(insId);
  if (!proj || !g || g.kind !== 'yoke' || !g.spec) return;
  const spec = g.spec;
  mutate(id, (p) => {
    const t = (p.trackers[spec.id] ??= { row: 1, firstOverrides: {} });
    t.row = Math.max(1, t.row - 1);
  });
}

/** ROUND DONE for a measured event (e.g. a sleeve decrease round). */
export function measuredEventDone(id: string, insId: string) {
  mutate(id, (p) => {
    const k = knitOf(p);
    const mk = measuredKey(insId);
    const cur = k.measured[mk] ?? { done: 0, due: false };
    k.measured[mk] = { done: cur.done + 1, due: false };
  });
}
