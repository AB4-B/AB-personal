/**
 * Backup file and restore. The file is made for the knitter to keep in Files / iCloud: a web app on iPhone cannot
 * write there by itself, so it is only counted as a backup once the saved file has been opened again and checked
 * ("verified"). Restore never replaces data that is newer on the phone, and always keeps the pattern version the
 * progress was made on.
 */
import type { Pattern, Project } from '../model/types';
import type { Repo } from './db';
import { hashPattern } from './history';

export const BACKUP_FILE = 'knit-guide-backup.json';
export const BACKUP_VERSION = 2;
const DAY = 24 * 60 * 60 * 1000;
const LS_VERIFIED = 'kg:backup:verifiedAt';
const LS_EXPORT = 'kg:backup:exportAt';

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

/** When a backup file was last opened again and checked. Saving alone does not count. */
export const lastVerifiedBackupAt = () => lsGet(LS_VERIFIED);
export const lastExportAt = () => lsGet(LS_EXPORT);
export const backupDue = (now = Date.now()) => now - lastVerifiedBackupAt() > DAY;

/* ------------------------------------------------------------------ make */

const toB64 = async (b: Blob) => {
  const u = new Uint8Array(await b.arrayBuffer());
  let out = '';
  for (let i = 0; i < u.length; i += 0x8000) out += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(out);
};
const fromB64 = (data: string, type: string) => {
  const bin = atob(data);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type });
};

export async function makeBackupFile(repo: Repo, projects: Project[]): Promise<File> {
  const all = await repo.loadAll();
  const patterns = all.patterns;
  const hashes = Object.fromEntries(patterns.map((p) => [p.id, hashPattern(p)]));
  const parts: BlobPart[] = [
    `{"app":"knit-guide","version":${BACKUP_VERSION},"createdAt":${Date.now()},"hashes":${JSON.stringify(hashes)},"patterns":${JSON.stringify(patterns)},"projects":${JSON.stringify(projects)},"files":[`,
  ];
  const files = await repo.allFiles();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    parts.push(`${i ? ',' : ''}${JSON.stringify({ id: f.id, type: f.blob.type, size: f.blob.size, data: await toB64(f.blob) })}`);
  }
  parts.push(']}');
  return new File(parts, BACKUP_FILE, { type: 'application/json' });
}

export type ShareResult = 'shared' | 'downloaded' | 'cancelled';

/** Hands the file to the iPhone share sheet (Save to Files) or downloads it. This does NOT prove it was saved. */
export async function saveBackupFile(repo: Repo, projects: Project[]): Promise<ShareResult> {
  const file = await makeBackupFile(repo, projects);
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  try {
    if (nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], title: 'Knit Guide backup' });
      lsSet(LS_EXPORT, Date.now());
      return 'shared';
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = BACKUP_FILE;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    lsSet(LS_EXPORT, Date.now());
    return 'downloaded';
  } catch (e) {
    if ((e as Error).name === 'AbortError') return 'cancelled';
    throw e;
  }
}

/* ------------------------------------------------------------------ read */

export interface BackupData {
  createdAt: number;
  patterns: Pattern[];
  projects: Project[];
  hashes: Record<string, string>;
  files: { id: string; size: number; blob: () => Blob }[];
}

export async function readBackupFile(file: File): Promise<BackupData> {
  let raw: any;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new Error('This is not a complete Knit Guide backup file (it could not be read).');
  }
  if (raw?.app !== 'knit-guide' || !Array.isArray(raw.projects) || !Array.isArray(raw.patterns)) throw new Error('This is not a Knit Guide backup file.');
  const files = (raw.files ?? []) as { id: string; type: string; size?: number; data: string }[];
  const hashes: Record<string, string> = raw.hashes ?? Object.fromEntries((raw.patterns as Pattern[]).map((p) => [p.id, hashPattern(p)]));
  return {
    createdAt: Number(raw.createdAt) || 0,
    patterns: raw.patterns,
    projects: raw.projects,
    hashes,
    files: files.map((f) => ({ id: f.id, size: f.size ?? -1, blob: () => fromB64(f.data, f.type) })),
  };
}

export interface VerifyReport {
  ok: boolean;
  createdAt: number;
  projects: number;
  problems: string[];
  /** worth knowing, but the file is still a good backup (e.g. a PDF the phone itself no longer has) */
  warnings: string[];
  /** projects with progress newer on the phone than in this file */
  newerOnPhone: string[];
}

/** Open a saved backup file and check it is whole and matches what is on the phone. */
export async function verifyBackupFile(file: File, live: Project[], exportedAfter = 0, phoneHasFile: (id: string) => Promise<boolean> = async () => true): Promise<VerifyReport> {
  const problems: string[] = [];
  const warnings: string[] = [];
  let data: BackupData;
  try {
    data = await readBackupFile(file);
  } catch (e) {
    return { ok: false, createdAt: 0, projects: 0, problems: [(e as Error).message], warnings, newerOnPhone: [] };
  }
  const ids = new Set(data.patterns.map((p) => p.id));
  for (const p of data.projects) if (!ids.has(p.patternId)) problems.push(`"${p.name}": its pattern is missing from the file.`);
  const fileIds = new Map(data.files.map((f) => [f.id, f]));
  for (const pat of data.patterns) {
    if (!fileIds.has(pat.fileId)) {
      if (await phoneHasFile(pat.fileId)) problems.push(`"${pat.title}": the original PDF is not in the file.`);
      else warnings.push(`"${pat.title}": the original PDF is not on this phone either, so it is not in the file.`);
    }
  }
  for (const f of data.files) {
    if (f.size >= 0 && f.blob().size !== f.size) problems.push(`A stored file is damaged (${f.id}).`);
  }
  const inFile = new Map(data.projects.map((p) => [p.id, p]));
  for (const p of live) if (!inFile.has(p.id)) problems.push(`"${p.name}" is on the phone but not in this file.`);
  const newerOnPhone = live.filter((p) => inFile.has(p.id) && (p.rev ?? 0) > (inFile.get(p.id)!.rev ?? 0)).map((p) => p.name);
  if (exportedAfter && data.createdAt < exportedAfter - 1000) problems.push('This file is older than the backup you just made. Pick the new one.');
  const ok = problems.length === 0;
  if (ok) lsSet(LS_VERIFIED, Date.now());
  return { ok, createdAt: data.createdAt, projects: data.projects.length, problems, warnings, newerOnPhone };
}

/* ------------------------------------------------------------------ restore */

export type RestoreAction = 'new' | 'replace' | 'same' | 'keep-phone';

export interface RestoreItem {
  project: Project;
  action: RestoreAction;
  name: string;
  /** the backup's version of this project is older than the one on the phone */
  phoneRev?: number;
  backupRev: number;
}

/** Decide, project by project, what a restore would do. Never chooses to replace newer data. */
export function planRestore(data: BackupData, live: Project[]): RestoreItem[] {
  const mine = new Map(live.map((p) => [p.id, p]));
  return data.projects.map((p) => {
    const cur = mine.get(p.id);
    let action: RestoreAction;
    if (!cur) action = 'new';
    else if ((p.rev ?? 0) > (cur.rev ?? 0) && p.updatedAt >= cur.updatedAt) action = 'replace';
    else if ((p.rev ?? 0) === (cur.rev ?? 0) && p.updatedAt === cur.updatedAt) action = 'same';
    else action = 'keep-phone';
    return { project: p, action, name: p.name, phoneRev: cur?.rev, backupRev: p.rev ?? 0 };
  });
}

/** Ask iOS / the browser not to clear this site's data to free space. */
export async function requestPersistence(): Promise<boolean | undefined> {
  try {
    return await navigator.storage?.persist?.();
  } catch {
    return undefined;
  }
}
export async function isPersisted(): Promise<boolean | undefined> {
  try {
    return await navigator.storage?.persisted?.();
  } catch {
    return undefined;
  }
}

/** The single automatic copy made by the previous version of the app (read only; kept so nothing is lost). */
export async function readLegacySnapshot(): Promise<BackupData | undefined> {
  try {
    if (typeof indexedDB === 'undefined') return undefined;
    const names = (await indexedDB.databases?.())?.map((d) => d.name) ?? ['knit-guide-backup'];
    if (!names.includes('knit-guide-backup')) return undefined;
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('knit-guide-backup');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!db.objectStoreNames.contains('snap')) {
      db.close();
      return undefined;
    }
    const s: any = await new Promise((resolve, reject) => {
      const r = db.transaction('snap', 'readonly').objectStore('snap').get('latest');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    if (!s?.projects) return undefined;
    return {
      createdAt: s.createdAt ?? 0,
      patterns: s.patterns ?? [],
      projects: s.projects,
      hashes: Object.fromEntries((s.patterns ?? []).map((p: Pattern) => [p.id, hashPattern(p)])),
      files: (s.files ?? []).map((f: { id: string; blob: Blob }) => ({ id: f.id, size: f.blob.size, blob: () => f.blob })),
    };
  } catch {
    return undefined;
  }
}
