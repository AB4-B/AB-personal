/**
 * Local persistence (IndexedDB). All access goes through the `Repo` interface so a
 * cloud-sync implementation can replace or wrap it later without touching the UI.
 */
import type { Pattern, Project } from '../model/types';

export interface Repo {
  loadAll(): Promise<{ patterns: Pattern[]; projects: Project[] }>;
  putPattern(p: Pattern): Promise<void>;
  putProject(p: Project): Promise<void>;
  deleteProject(id: string): Promise<void>;
  deletePattern(id: string): Promise<void>;
  putFile(id: string, blob: Blob): Promise<void>;
  getFile(id: string): Promise<Blob | undefined>;
  deleteFile(id: string): Promise<void>;
  allFiles(): Promise<{ id: string; blob: Blob }[]>;
}

const DB_NAME = 'knit-guide';
const DB_VERSION = 1;
const STORES = ['patterns', 'projects', 'files'] as const;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

class IdbRepo implements Repo {
  private dbp = openDb();

  private async tx<T>(store: (typeof STORES)[number], mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.dbp;
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  async loadAll() {
    const [patterns, projects] = await Promise.all([
      this.tx('patterns', 'readonly', (s) => s.getAll() as IDBRequest<Pattern[]>),
      this.tx('projects', 'readonly', (s) => s.getAll() as IDBRequest<Project[]>),
    ]);
    return { patterns, projects };
  }
  async putPattern(p: Pattern) {
    await this.tx('patterns', 'readwrite', (s) => s.put(p, p.id));
  }
  async putProject(p: Project) {
    await this.tx('projects', 'readwrite', (s) => s.put(p, p.id));
  }
  async deleteProject(id: string) {
    await this.tx('projects', 'readwrite', (s) => s.delete(id));
  }
  async deletePattern(id: string) {
    await this.tx('patterns', 'readwrite', (s) => s.delete(id));
  }
  async putFile(id: string, blob: Blob) {
    await this.tx('files', 'readwrite', (s) => s.put(blob, id));
  }
  async getFile(id: string) {
    return (await this.tx('files', 'readonly', (s) => s.get(id) as IDBRequest<Blob | undefined>)) ?? undefined;
  }
  async deleteFile(id: string) {
    await this.tx('files', 'readwrite', (s) => s.delete(id));
  }
  async allFiles() {
    const keys = (await this.tx('files', 'readonly', (s) => s.getAllKeys())) as string[];
    const blobs = (await this.tx('files', 'readonly', (s) => s.getAll())) as Blob[];
    return keys.map((id, i) => ({ id, blob: blobs[i] }));
  }
}

/** Fallback when IndexedDB is unavailable (e.g. some private modes): works for the session only. */
class MemoryRepo implements Repo {
  patterns = new Map<string, Pattern>();
  projects = new Map<string, Project>();
  files = new Map<string, Blob>();
  async loadAll() {
    return { patterns: [...this.patterns.values()], projects: [...this.projects.values()] };
  }
  async putPattern(p: Pattern) { this.patterns.set(p.id, p); }
  async putProject(p: Project) { this.projects.set(p.id, p); }
  async deleteProject(id: string) { this.projects.delete(id); }
  async deletePattern(id: string) { this.patterns.delete(id); }
  async putFile(id: string, b: Blob) { this.files.set(id, b); }
  async getFile(id: string) { return this.files.get(id); }
  async deleteFile(id: string) { this.files.delete(id); }
  async allFiles() { return [...this.files].map(([id, blob]) => ({ id, blob })); }
}

export function createRepo(): Repo {
  try {
    if (typeof indexedDB !== 'undefined') return new IdbRepo();
  } catch {
    /* fall through */
  }
  return new MemoryRepo();
}
