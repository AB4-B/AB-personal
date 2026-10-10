/**
 * Restoring: from a recovery point or from a backup file. Rules, in order of importance:
 *  1. Nothing newer on the phone is replaced (backup restore) and anything that is replaced gets a recovery point first.
 *  2. A restored project always gets the exact pattern version it was knitted against (a copy, so no other project
 *     that shares the pattern is affected).
 *  3. A restored project is stamped as the newest change, so it is not mistaken for old data afterwards.
 */
import { now } from '../model/helpers';
import type { Pattern, Project } from '../model/types';
import { planRestore, type BackupData, type RestoreItem } from '../storage/backup';
import { hashPattern, type Checkpoint } from '../storage/history';
import { adoptProject, checkpointNow, history, repo, useStore } from './store';

/** Which pattern id a restored project should use, and the pattern to write (if any). */
function patternFor(patternId: string, wantHash: string, wanted: Pattern | undefined): { id: string; write?: Pattern } {
  const current = useStore.getState().patterns[patternId];
  if (current && hashPattern(current) === wantHash) return { id: patternId };
  if (!wanted) throw new Error('The pattern this progress belongs to is not in the recovery data.');
  if (!current) return { id: patternId, write: { ...wanted, id: patternId } };
  const copyId = `${patternId}~${wantHash}`;
  if (useStore.getState().patterns[copyId]) return { id: copyId };
  return { id: copyId, write: { ...wanted, id: copyId } };
}

async function stamp(project: Project, patternId: string): Promise<Project> {
  const cur = useStore.getState().projects[project.id];
  return { ...structuredClone(project), patternId, rev: Math.max(cur?.rev ?? 0, project.rev ?? 0) + 1, updatedAt: now() };
}

/** Put a project back exactly as it was at a recovery point. */
export async function restoreCheckpoint(cp: Checkpoint): Promise<string> {
  const wanted = await history.pattern(cp.patternHash);
  const pat = patternFor(cp.project.patternId, cp.patternHash, wanted);
  if (useStore.getState().projects[cp.projectId]) await checkpointNow(cp.projectId, 'before restore');
  const project = await stamp(cp.project, pat.id);
  await adoptProject(project, pat.write);
  const pdf = await repo.getFile((pat.write ?? useStore.getState().patterns[pat.id]).fileId);
  return pdf ? 'Restored.' : 'Restored. The original PDF is not on this phone, so “View original” will be empty.';
}

/** Projects that have recovery points but are no longer in the library (deleted, or the library was lost). */
export async function listRecoverable(): Promise<Checkpoint[]> {
  const all = await history.list();
  const here = useStore.getState().projects;
  const latest = new Map<string, Checkpoint>();
  for (const c of all) if (!here[c.projectId] && !latest.has(c.projectId)) latest.set(c.projectId, c);
  return [...latest.values()];
}

/** Apply a restore plan. Returns what was done. */
export async function applyRestore(data: BackupData, items: RestoreItem[]): Promise<{ restored: number; kept: number }> {
  let restored = 0;
  let kept = 0;
  const todo = items.filter((i) => i.action === 'new' || i.action === 'replace');
  kept = items.length - todo.length;
  // files first: only ones the phone does not already have
  for (const f of data.files) if (!(await repo.getFile(f.id))) await repo.putFile(f.id, f.blob());
  for (const it of todo) {
    const wanted = data.patterns.find((p) => p.id === it.project.patternId);
    const pat = patternFor(it.project.patternId, data.hashes[it.project.patternId] ?? (wanted ? hashPattern(wanted) : ''), wanted);
    if (it.action === 'replace') await checkpointNow(it.project.id, 'before restore');
    await adoptProject(await stamp(it.project, pat.id), pat.write);
    restored++;
  }
  return { restored, kept };
}

export { planRestore };
