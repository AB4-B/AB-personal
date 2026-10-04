/**
 * Backups. Two layers, both free and on the device:
 *  1. An automatic snapshot, taken at most once a day when the app is open, kept in a SEPARATE IndexedDB database
 *     and overwritten each time (one snapshot only). It protects against a bad save or a bug, not against iOS
 *     clearing all of this site's data.
 *  2. A backup FILE the knitter saves to Files / iCloud. A web app on iPhone cannot write a file by itself, so
 *     the file needs one tap (the app reminds her when it is more than a day old). Saving it under the same name
 *     replaces the previous one.
 */
import type { Pattern, Project } from '../model/types';
import type { Repo } from './db';

export const BACKUP_FILE = 'knit-guide-backup.json';
const DAY = 24 * 60 * 60 * 1000;
const LS_SNAP = 'kg:backup:snapshotAt';
const LS_FILE = 'kg:backup:fileAt';

interface Snapshot {
  app: 'knit-guide';
  version: 1;
  createdAt: number;
  patterns: Pattern[];
  projects: Project[];
  files: { id: string; blob: Blob }[];
}

const lsGet = (k: string) => {
  try {
    return Number(localStorage.getItem(k)) || 0;
  } catch {
    return 0;
  }
};
const lsSet = (k: string, v: number) => {
  try {
    localStorage.setItem(k, String(v));
  } catch {
    /* ignore */
  }
};

export const lastSnapshotAt = () => lsGet(LS_SNAP);
export const lastFileBackupAt = () => lsGet(LS_FILE);
export const fileBackupDue = (now = Date.now()) => now - lastFileBackupAt() > DAY;
export const snapshotDue = (now = Date.now()) => now - lastSnapshotAt() > DAY - 60 * 60 * 1000;

async function collect(repo: Repo, projects?: Project[]): Promise<Snapshot> {
  const all = await repo.loadAll();
  return { app: 'knit-guide', version: 1, createdAt: Date.now(), patterns: all.patterns, projects: projects ?? all.projects, files: await repo.allFiles() };
}

/* ----- automatic snapshot (separate database, one record, overwritten) */

function snapDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('knit-guide-backup', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('snap');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function snapPut(s: Snapshot) {
  const db = await snapDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction('snap', 'readwrite');
    t.objectStore('snap').put(s, 'latest');
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
  db.close();
}
async function snapGet(): Promise<Snapshot | undefined> {
  const db = await snapDb();
  const r = await new Promise<Snapshot | undefined>((resolve, reject) => {
    const req = db.transaction('snap', 'readonly').objectStore('snap').get('latest');
    req.onsuccess = () => resolve(req.result as Snapshot | undefined);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return r;
}

/** Take today's snapshot if there is none from the last day. `projects` is the live state (newer than the database). */
export async function autoSnapshot(repo: Repo, projects: Project[], force = false): Promise<boolean> {
  try {
    if (typeof indexedDB === 'undefined' || (!force && !snapshotDue())) return false;
    if (!projects.length) return false; // never overwrite a good snapshot with an empty one
    const s = await collect(repo, projects);
    await snapPut(s);
    lsSet(LS_SNAP, s.createdAt);
    return true;
  } catch (e) {
    console.error('auto snapshot failed', e);
    return false;
  }
}

export async function snapshotInfo(): Promise<{ createdAt: number; projects: number } | undefined> {
  try {
    const s = await snapGet();
    return s ? { createdAt: s.createdAt, projects: s.projects.length } : undefined;
  } catch {
    return undefined;
  }
}

/* ----- file backup */

const toB64 = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
const fromB64 = (data: string, type: string) => {
  const bin = atob(data);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type });
};

export async function makeBackupFile(repo: Repo, projects: Project[]): Promise<{ file: File; counts: { projects: number; patterns: number } }> {
  const s = await collect(repo, projects);
  const files = await Promise.all(s.files.map(async (f) => ({ id: f.id, type: f.blob.type, data: await toB64(f.blob) })));
  const json = JSON.stringify({ app: s.app, version: s.version, createdAt: s.createdAt, patterns: s.patterns, projects: s.projects, files });
  return { file: new File([json], BACKUP_FILE, { type: 'application/json' }), counts: { projects: s.projects.length, patterns: s.patterns.length } };
}

/** Share sheet on iPhone (Save to Files), plain download elsewhere. Returns false when the knitter cancelled. */
export async function saveBackupFile(repo: Repo, projects: Project[]): Promise<boolean> {
  const { file } = await makeBackupFile(repo, projects);
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  try {
    if (nav.canShare?.({ files: [file] })) await nav.share({ files: [file], title: 'Knit Guide backup' });
    else {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = BACKUP_FILE;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return false;
    throw e;
  }
  lsSet(LS_FILE, Date.now());
  return true;
}

/* ----- restore */

export interface RestoreResult {
  projects: number;
  patterns: number;
  kept: number;
}

/** Put a snapshot back. A project already on the device is replaced only when the backup copy is newer (or equal). */
async function applySnapshot(repo: Repo, s: Snapshot): Promise<RestoreResult> {
  const have = await repo.loadAll();
  const mine = new Map(have.projects.map((p) => [p.id, p]));
  let kept = 0;
  let restored = 0;
  for (const f of s.files) await repo.putFile(f.id, f.blob);
  const known = new Set(have.patterns.map((p) => p.id));
  for (const p of s.patterns) if (!known.has(p.id)) await repo.putPattern(p);
  for (const p of s.projects) {
    const cur = mine.get(p.id);
    if (cur && ((cur.rev ?? 0) > (p.rev ?? 0) || cur.updatedAt > p.updatedAt)) {
      kept++;
      continue;
    }
    await repo.putProject(p);
    restored++;
  }
  return { projects: restored, patterns: s.patterns.length, kept };
}

export async function restoreFromFile(repo: Repo, file: File): Promise<RestoreResult> {
  let raw: any;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new Error('This is not a Knit Guide backup file.');
  }
  if (raw?.app !== 'knit-guide' || !Array.isArray(raw.projects) || !Array.isArray(raw.patterns)) throw new Error('This is not a Knit Guide backup file.');
  const s: Snapshot = { ...raw, files: (raw.files ?? []).map((f: any) => ({ id: f.id, blob: fromB64(f.data, f.type) })) };
  return applySnapshot(repo, s);
}

export async function restoreFromSnapshot(repo: Repo): Promise<RestoreResult> {
  const s = await snapGet();
  if (!s) throw new Error('There is no automatic snapshot yet.');
  return applySnapshot(repo, s);
}

/** Ask iOS / the browser not to clear this site's data to free space. */
export async function requestPersistence(): Promise<boolean | undefined> {
  try {
    return await navigator.storage?.persist?.();
  } catch {
    return undefined;
  }
}
