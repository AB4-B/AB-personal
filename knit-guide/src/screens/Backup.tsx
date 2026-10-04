import { useEffect, useRef, useState } from 'react';
import { autoSnapshot, fileBackupDue, lastFileBackupAt, lastSnapshotAt, requestPersistence, restoreFromFile, restoreFromSnapshot, saveBackupFile, snapshotInfo } from '../storage/backup';
import { flushWrites, repo, useStore } from '../store/store';
import { formatWhen } from '../model/helpers';
import { ConfirmButton } from '../ui/common';

/** Backup status, "save backup file" and restore. Everything is on the device; nothing is uploaded. */
export function BackupPanel() {
  const projects = useStore((s) => s.projects);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [snap, setSnap] = useState<{ createdAt: number; projects: number }>();
  const [, bump] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const count = Object.keys(projects).length;

  useEffect(() => {
    void snapshotInfo().then(setSnap);
    void requestPersistence();
  }, []);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg('');
    try {
      setMsg(await fn());
    } catch (e) {
      setMsg(`⚠ ${(e as Error).message}`);
    }
    setBusy(false);
    bump((n) => n + 1);
  };
  const after = (r: { projects: number; kept: number }) => {
    setTimeout(() => location.reload(), 900);
    return `✓ Restored ${r.projects} project${r.projects === 1 ? '' : 's'}${r.kept ? ` (${r.kept} newer on this phone kept)` : ''}. Reloading…`;
  };
  const due = fileBackupDue();

  return (
    <section className="card stack" data-testid="backup-panel" style={{ margin: '16px 20px 0' }}>
      <span className="caps">BACKUP</span>
      {due && count > 0 && (
        <div className="jobs plain" data-testid="backup-due">⚠ No backup file saved in the last day. Tap SAVE BACKUP FILE and choose Files / iCloud Drive.</div>
      )}
      <div className="small-text" data-testid="backup-status">
        <div>Automatic copy (inside the app, once a day): {lastSnapshotAt() ? formatWhen(lastSnapshotAt()) : 'not yet'}{snap ? ` · ${snap.projects} project${snap.projects === 1 ? '' : 's'}` : ''}</div>
        <div>Backup file saved to Files: {lastFileBackupAt() ? formatWhen(lastFileBackupAt()) : 'never'}</div>
      </div>
      <button
        className="btn primary"
        disabled={busy || count === 0}
        data-testid="backup-save"
        onClick={() => run(async () => {
          await flushWrites();
          const live = Object.values(useStore.getState().projects);
          const ok = await saveBackupFile(repo, live);
          if (ok) {
            await autoSnapshot(repo, live, true);
            setSnap(await snapshotInfo());
          }
          return ok ? '✓ Backup file saved. Saving it under the same name replaces the old one.' : 'Cancelled. Nothing was saved.';
        })}
      >
        SAVE BACKUP FILE
      </button>
      <div className="row wrap">
        <button className="btn soft" disabled={busy} data-testid="backup-restore-file" onClick={() => input.current?.click()}>Restore from file</button>
        <input ref={input} type="file" accept="application/json,.json" hidden data-testid="backup-file-input" onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void run(async () => after(await restoreFromFile(repo, f)));
        }} />
        <ConfirmButton className="btn soft" label="Restore automatic copy" confirmLabel="Tap again to restore" onConfirm={() => void run(async () => after(await restoreFromSnapshot(repo)))} />
      </div>
      {msg && <div className="small-text" data-testid="backup-msg" role="status">{msg}</div>}
      <p className="tiny muted" style={{ margin: 0 }}>The automatic copy sits in the same phone storage, so it does not protect against iOS clearing this site's data. The backup file in Files does. An iPhone web app cannot write that file by itself; it needs one tap.</p>
    </section>
  );
}
