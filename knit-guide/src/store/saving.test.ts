/** Saving, recovery points and restore, against the in-memory repository (the browser tests cover real IndexedDB). */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pattern, Project } from '../model/types';
import { finalizePattern } from '../parser/edit';
import { parsePastedText } from '../parser/parse';
import { planRestore, readBackupFile, makeBackupFile, verifyBackupFile } from '../storage/backup';
import { hashPattern } from '../storage/history';
import { sameStructure } from '../pdf/reread';
import { applyRestore, listRecoverable, restoreCheckpoint } from './recovery';
import { checkpointNow, createProject, deleteProject, flushWrites, history, initStore, repo, retrySaves, setSize, tickStep, useStore } from './store';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
});

const scarf = (): Pattern => finalizePattern(parsePastedText(readFileSync('fixtures/synthetic-scarf.txt', 'utf8'), {}));
async function make(name = 'Scarf'): Promise<Project> {
  const pattern = scarf();
  return createProject({ pattern, fileBlob: new Blob(['x']), imageBlobs: {}, name, size: 'One size', setup: { yarn: '', colour: '', needle: '', gaugeSts: '', gaugeRows: '', bodyLength: '', sleeveLength: '' } });
}
const get = (id: string) => useStore.getState().projects[id];
const ticks = (id: string, n: number) => { for (let i = 0; i < n; i++) tickStep(id, 'k', i, true); };

beforeEach(async () => {
  store.clear();
  const all = await repo.loadAll();
  for (const p of all.projects) await repo.deleteProject(p.id);
  for (const p of all.patterns) await repo.deletePattern(p.id);
  useStore.setState({ projects: {}, patterns: {}, loadError: undefined, loaded: true, saveStatus: 'saved' });
  for (const c of await history.list()) void c;
});

describe('save status and retries', () => {
  it('shows saved only after the write was confirmed', async () => {
    const p = await make();
    ticks(p.id, 3);
    expect(useStore.getState().saveStatus).toBe('saving');
    await flushWrites();
    expect(useStore.getState().saveStatus).toBe('saved');
    expect((await repo.loadAll()).projects.find((x) => x.id === p.id)!.knit!.stepsDone.k).toEqual([0, 1, 2]);
  });

  it('a failed write is reported, kept in the safety copy, and retried to success', async () => {
    const p = await make();
    await flushWrites();
    const real = repo.putProject.bind(repo);
    repo.putProject = async () => { throw new Error('disk full'); };
    ticks(p.id, 2);
    await flushWrites();
    expect(useStore.getState().saveStatus).toBe('failed');
    expect(store.get(`kg:wal:${p.id}`)).toBeTruthy(); // safety copy kept
    expect((await repo.loadAll()).projects.find((x) => x.id === p.id)!.knit).toBeUndefined();
    repo.putProject = real;
    retrySaves();
    await flushWrites();
    expect(useStore.getState().saveStatus).toBe('saved');
    expect((await repo.loadAll()).projects.find((x) => x.id === p.id)!.knit!.stepsDone.k).toEqual([0, 1]);
    expect(store.get(`kg:wal:${p.id}`)).toBeUndefined();
  });

  it('an interrupted save is replayed from the safety copy when the app reopens', async () => {
    const p = await make();
    await flushWrites();
    const real = repo.putProject.bind(repo);
    repo.putProject = async () => { throw new Error('killed'); };
    ticks(p.id, 4);
    await flushWrites();
    repo.putProject = real;
    useStore.setState({ projects: {}, patterns: {} }); // the app was closed
    await initStore();
    expect(get(p.id).knit!.stepsDone.k).toEqual([0, 1, 2, 3]);
    await flushWrites();
    expect((await repo.loadAll()).projects.find((x) => x.id === p.id)!.knit!.stepsDone.k).toEqual([0, 1, 2, 3]);
  });
});

describe('a library that cannot be read', () => {
  it('shows an error, never an empty library, and writes nothing', async () => {
    const p = await make();
    await flushWrites();
    const real = repo.loadAll.bind(repo);
    repo.loadAll = async () => { throw new Error('IndexedDB blocked'); };
    await initStore();
    expect(useStore.getState().loadError).toMatch(/blocked/);
    expect(Object.keys(useStore.getState().projects)).toHaveLength(0);
    tickStep(p.id, 'k', 0, true); // no project in memory: must not create or overwrite anything
    repo.loadAll = real;
    expect((await repo.loadAll()).projects.find((x) => x.id === p.id)!.knit).toBeUndefined();
    await initStore();
    expect(useStore.getState().loadError).toBeUndefined();
    expect(get(p.id)).toBeTruthy();
  });
});

describe('recovery points', () => {
  it('restores an earlier point, saves the current state first, and can be undone', async () => {
    const p = await make();
    ticks(p.id, 3);
    await flushWrites();
    await checkpointNow(p.id, 'manual');
    tickStep(p.id, 'k', 3, true);
    tickStep(p.id, 'k', 4, true);
    await flushWrites();
    const cps = await history.list(p.id);
    const early = cps.find((c) => c.reason === 'manual')!;
    expect(early.project.knit!.stepsDone.k).toEqual([0, 1, 2]);
    await restoreCheckpoint(early);
    expect(get(p.id).knit!.stepsDone.k).toEqual([0, 1, 2]);
    expect(get(p.id).rev!).toBeGreaterThan(early.rev);
    const before = (await history.list(p.id)).find((c) => c.reason === 'before restore')!;
    expect(before.project.knit!.stepsDone.k).toEqual([0, 1, 2, 3, 4]);
    await restoreCheckpoint(before); // undo
    expect(get(p.id).knit!.stepsDone.k).toEqual([0, 1, 2, 3, 4]);
  });

  it('a point is only added when something changed, and is never overwritten', async () => {
    const p = await make();
    await flushWrites();
    const n0 = (await history.list(p.id)).length;
    await history.maybe(get(p.id), useStore.getState().patterns[p.patternId], 'automatic', 0);
    expect((await history.list(p.id)).length).toBe(n0); // unchanged since the last point
    tickStep(p.id, 'k', 0, true);
    await flushWrites();
    await history.maybe(get(p.id), useStore.getState().patterns[p.patternId], 'automatic', 0);
    expect((await history.list(p.id)).length).toBeGreaterThan(n0);
  });

  it('a deleted project can be recovered with the pattern it used', async () => {
    const p = await make('Gone');
    ticks(p.id, 2);
    await flushWrites();
    await deleteProject(p.id);
    expect(get(p.id)).toBeUndefined();
    const gone = await listRecoverable();
    expect(gone.map((c) => c.project.name)).toContain('Gone');
    const msg = await restoreCheckpoint(gone.find((c) => c.projectId === p.id)!);
    expect(get(p.id).knit!.stepsDone.k).toEqual([0, 1]);
    expect(useStore.getState().patterns[get(p.id).patternId]).toBeTruthy();
    expect(msg).toMatch(/Restored/);
  });

  it('a size change takes a recovery point first', async () => {
    const p = await make();
    await flushWrites();
    setSize(p.id, 'Other');
    await new Promise((r) => setTimeout(r, 20));
    expect((await history.list(p.id)).some((c) => c.reason === 'before size change' && c.project.size === 'One size')).toBe(true);
  });

  it('restores the pattern version the progress was made on, as a copy', async () => {
    const p = await make();
    ticks(p.id, 2);
    await flushWrites();
    await checkpointNow(p.id, 'manual');
    const oldHash = hashPattern(useStore.getState().patterns[p.patternId]);
    // the pattern is "re-read" into something different
    const changed = structuredClone(useStore.getState().patterns[p.patternId]);
    changed.instructions[0].text = 'Changed text';
    await repo.putPattern(changed);
    useStore.setState((s) => ({ patterns: { ...s.patterns, [changed.id]: changed } }));
    const cp = (await history.list(p.id)).find((c) => c.reason === 'manual')!;
    expect(cp.patternHash).toBe(oldHash);
    await restoreCheckpoint(cp);
    const restored = get(p.id);
    expect(restored.patternId).not.toBe(p.patternId);
    expect(hashPattern(useStore.getState().patterns[restored.patternId])).toBe(oldHash);
    expect(useStore.getState().patterns[p.patternId].instructions[0].text).toBe('Changed text'); // the other pattern is untouched
  });
});

describe('backup file', () => {
  it('round trips, verifies, and never replaces newer data on the phone', async () => {
    const p = await make('A');
    ticks(p.id, 2);
    await flushWrites();
    const file = await makeBackupFile(repo, Object.values(useStore.getState().projects));
    const ok = await verifyBackupFile(file, Object.values(useStore.getState().projects));
    expect(ok.ok).toBe(true);
    // progress made after the backup
    tickStep(p.id, 'k', 2, true);
    await flushWrites();
    const data = await readBackupFile(file);
    const plan = planRestore(data, Object.values(useStore.getState().projects));
    expect(plan[0].action).toBe('keep-phone');
    const r = await applyRestore(data, plan);
    expect(r.restored).toBe(0);
    expect(get(p.id).knit!.stepsDone.k).toEqual([0, 1, 2]);
  });

  it('replaces an older copy on the phone, after taking a recovery point of it', async () => {
    const p = await make('E');
    ticks(p.id, 5);
    await flushWrites();
    const file = await makeBackupFile(repo, Object.values(useStore.getState().projects));
    const data = await readBackupFile(file);
    // the phone's copy is older than the file (e.g. the phone was restored from an earlier point)
    const older = { ...structuredClone(get(p.id)), rev: 1, updatedAt: 1, knit: { ...get(p.id).knit!, stepsDone: { k: [0] } } };
    useStore.setState((s) => ({ projects: { ...s.projects, [p.id]: older } }));
    const plan = planRestore(data, Object.values(useStore.getState().projects));
    expect(plan[0].action).toBe('replace');
    const r = await applyRestore(data, plan);
    expect(r.restored).toBe(1);
    expect(get(p.id).knit!.stepsDone.k).toEqual([0, 1, 2, 3, 4]);
    expect((await history.list(p.id)).some((c) => c.reason === 'before restore' && c.project.knit!.stepsDone.k.length === 1)).toBe(true);
  });

  it('restores a project that is missing, and a damaged file is rejected', async () => {
    const p = await make('B');
    ticks(p.id, 1);
    await flushWrites();
    const file = await makeBackupFile(repo, Object.values(useStore.getState().projects));
    await deleteProject(p.id);
    const data = await readBackupFile(file);
    const plan = planRestore(data, []);
    expect(plan[0].action).toBe('new');
    await applyRestore(data, plan);
    expect(get(p.id).knit!.stepsDone.k).toEqual([0]);
    const bad = new File([(await file.text()).slice(0, 200)], 'x.json');
    expect((await verifyBackupFile(bad, [])).ok).toBe(false);
    expect((await verifyBackupFile(new File(['{"app":"other"}'], 'y.json'), [])).ok).toBe(false);
  });

  it('flags a project that is on the phone but missing from the file', async () => {
    const p = await make('C');
    await flushWrites();
    const file = await makeBackupFile(repo, Object.values(useStore.getState().projects));
    const extra = await make('D');
    await flushWrites();
    const r = await verifyBackupFile(file, Object.values(useStore.getState().projects));
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/"D"/);
    void p; void extra;
  });
});

describe('re-reading with progress', () => {
  it('only the same instructions in the same order count as safe', () => {
    const a = scarf();
    const same = structuredClone(a);
    same.instructions[0].text = 'repaired wording';
    expect(sameStructure(a, same)).toBe(true);
    const dropped = structuredClone(a);
    dropped.instructions.splice(1, 1);
    expect(sameStructure(a, dropped)).toBe(false);
  });
});
