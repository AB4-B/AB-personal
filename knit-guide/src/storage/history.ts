/**
 * Recovery points (checkpoints). A checkpoint is a timestamped copy of one project plus the exact pattern it was
 * knitted against (stored once per content hash). They are only ever ADDED; the only deletion is thinning old
 * ones (see chooseKeep). They live in their own database, so a fault in the main database does not touch them.
 * Both sit in the same iPhone site storage: the cloud backup (phase B) is what survives that being cleared.
 */
import type { Pattern, Project } from '../model/types';

export type CheckpointReason = 'automatic' | 'first' | 'manual' | 'before restore' | 'before re-read' | 'before size change' | 'before delete' | 'leaving app';

export interface Checkpoint {
  id: string;
  projectId: string;
  createdAt: number;
  reason: CheckpointReason;
  rev: number;
  patternHash: string;
  project: Project;
}

export interface HistoryStore {
  put(cp: Checkpoint, pattern: Pattern): Promise<void>;
  list(): Promise<Checkpoint[]>;
  pattern(hash: string): Promise<Pattern | undefined>;
  remove(ids: string[]): Promise<void>;
}

/** Small stable hash (cyrb53) of what a pattern says, ignoring timestamps and ids. */
export function hashPattern(p: Pattern): string {
  const { updatedAt: _u, createdAt: _c, parse: _p, id: _i, ...rest } = p as Pattern & { parse?: unknown };
  const s = JSON.stringify(rest);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export const DAY = 24 * 60 * 60 * 1000;

/**
 * Which checkpoints to keep for ONE project: the newest 40, everything from the last 24 hours, the first of each
 * of the last 30 days, and every manual / before-* point from the last 30 days. Everything else may be thinned.
 */
export function chooseKeep(cps: Checkpoint[], now: number): Set<string> {
  const sorted = [...cps].sort((a, b) => b.createdAt - a.createdAt);
  const keep = new Set<string>(sorted.slice(0, 40).map((c) => c.id));
  const firstOfDay = new Map<number, Checkpoint>();
  for (const c of [...sorted].reverse()) {
    const age = now - c.createdAt;
    if (age <= DAY) keep.add(c.id);
    if (age <= 30 * DAY) {
      const d = Math.floor(c.createdAt / DAY);
      if (!firstOfDay.has(d)) firstOfDay.set(d, c);
      if (c.reason !== 'automatic' && c.reason !== 'leaving app') keep.add(c.id);
    }
  }
  for (const c of firstOfDay.values()) keep.add(c.id);
  return keep;
}

/* ------------------------------------------------------------------ stores */

export class MemoryHistory implements HistoryStore {
  cps = new Map<string, Checkpoint>();
  patterns = new Map<string, Pattern>();
  async put(cp: Checkpoint, pattern: Pattern) {
    if (!this.patterns.has(cp.patternHash)) this.patterns.set(cp.patternHash, structuredClone(pattern));
    this.cps.set(cp.id, structuredClone(cp));
  }
  async list() {
    return [...this.cps.values()].map((c) => structuredClone(c));
  }
  async pattern(hash: string) {
    const p = this.patterns.get(hash);
    return p ? structuredClone(p) : undefined;
  }
  async remove(ids: string[]) {
    for (const id of ids) this.cps.delete(id);
  }
}

class IdbHistory implements HistoryStore {
  private dbp: Promise<IDBDatabase> = new Promise((resolve, reject) => {
    const req = indexedDB.open('knit-guide-history', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('checkpoints');
      req.result.createObjectStore('patterns');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  private async run<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
    const db = await this.dbp;
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      const req = fn(t);
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  async put(cp: Checkpoint, pattern: Pattern) {
    const have = await this.run(['patterns'], 'readonly', (t) => t.objectStore('patterns').getKey(cp.patternHash));
    await this.run(['checkpoints', 'patterns'], 'readwrite', (t) => {
      if (have === undefined) t.objectStore('patterns').put(pattern, cp.patternHash);
      t.objectStore('checkpoints').put(cp, cp.id);
    });
  }
  async list() {
    return ((await this.run(['checkpoints'], 'readonly', (t) => t.objectStore('checkpoints').getAll())) ?? []) as Checkpoint[];
  }
  async pattern(hash: string) {
    return (await this.run(['patterns'], 'readonly', (t) => t.objectStore('patterns').get(hash))) as Pattern | undefined;
  }
  async remove(ids: string[]) {
    await this.run(['checkpoints'], 'readwrite', (t) => {
      for (const id of ids) t.objectStore('checkpoints').delete(id);
    });
  }
}

export function createHistory(): HistoryStore {
  try {
    if (typeof indexedDB !== 'undefined') return new IdbHistory();
  } catch {
    /* fall through */
  }
  return new MemoryHistory();
}

/* ------------------------------------------------------------------ service */

export interface CheckpointService {
  /** Add a checkpoint. Returns false when it could not be written (the caller is never blocked by this). */
  add(project: Project, pattern: Pattern | undefined, reason: CheckpointReason): Promise<boolean>;
  /** Add one only when the project changed since its last checkpoint and enough time has passed. */
  maybe(project: Project, pattern: Pattern | undefined, reason: CheckpointReason, minGapMs: number): Promise<boolean>;
  list(projectId?: string): Promise<Checkpoint[]>;
  pattern(hash: string): Promise<Pattern | undefined>;
}

export function createCheckpointService(store: HistoryStore, clock: () => number = Date.now): CheckpointService {
  const last = new Map<string, { at: number; rev: number }>();
  let seq = 0;
  return {
    async add(project, pattern, reason) {
      if (!pattern) return false;
      try {
        const at = clock();
        const cp: Checkpoint = {
          id: `${project.id}:${at}:${++seq}`,
          projectId: project.id,
          createdAt: at,
          reason,
          rev: project.rev ?? 0,
          patternHash: hashPattern(pattern),
          project: structuredClone(project),
        };
        await store.put(cp, pattern);
        last.set(project.id, { at, rev: cp.rev });
        // thin old ones for this project; failures here never matter
        try {
          const mine = (await store.list()).filter((c) => c.projectId === project.id);
          const keep = chooseKeep(mine, at);
          const drop = mine.filter((c) => !keep.has(c.id)).map((c) => c.id);
          if (drop.length) await store.remove(drop);
        } catch {
          /* ignore */
        }
        return true;
      } catch (e) {
        console.error('checkpoint failed', e);
        return false;
      }
    },
    async maybe(project, pattern, reason, minGapMs) {
      const l = last.get(project.id);
      if (l && (l.rev === (project.rev ?? 0) || clock() - l.at < minGapMs)) return false;
      if (!l) {
        // first time since the app opened: compare with what is already stored
        try {
          const mine = (await store.list()).filter((c) => c.projectId === project.id).sort((a, b) => b.createdAt - a.createdAt)[0];
          if (mine) {
            last.set(project.id, { at: mine.createdAt, rev: mine.rev });
            if (mine.rev === (project.rev ?? 0) || clock() - mine.createdAt < minGapMs) return false;
          }
        } catch {
          /* fall through and try to write */
        }
      }
      return this.add(project, pattern, reason);
    },
    async list(projectId) {
      const all = await store.list();
      const seqOf = (c: Checkpoint) => Number(c.id.split(':').pop()) || 0;
      // newest first; two points made in the same millisecond keep their creation order
      return (projectId ? all.filter((c) => c.projectId === projectId) : all).sort((a, b) => b.createdAt - a.createdAt || seqOf(b) - seqOf(a));
    },
    pattern: (hash) => store.pattern(hash),
  };
}
