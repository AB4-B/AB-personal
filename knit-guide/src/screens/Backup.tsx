import { useEffect, useRef, useState } from 'react';
import { backupDue, isPersisted, lastExportAt, lastVerifiedBackupAt, planRestore, readBackupFile, readLegacySnapshot, requestPersistence, saveBackupFile, verifyBackupFile, type BackupData, type RestoreItem, type VerifyReport } from '../storage/backup';
import type { Checkpoint } from '../storage/history';
import { applyRestore, listRecoverable, restoreCheckpoint } from '../store/recovery';
import { checkpointNow, flushWrites, history, repo, useStore } from '../store/store';
import type { Project } from '../model/types';
import { ConfirmButton, Sheet } from '../ui/common';

export const when = (ts?: number) => (ts ? new Date(ts).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never');
export const stepsTicked = (p: Project) => Object.values(p.knit?.stepsDone ?? {}).reduce((n, a) => n + a.length, 0) + p.progress.completed.length;

/** One line that says whether the latest change is safe on the phone. */
export function SaveStatus({ compact }: { compact?: boolean }) {
  const status = useStore((s) => s.saveStatus);
  const at = useStore((s) => s.lastSavedAt);
  const memoryOnly = repo.kind === 'memory';
  if (memoryOnly) return <div className="small-text" data-testid="save-status" data-state="memory" role="status">⚠ This browser is not letting the app store data. Nothing you do will be kept after you close it.</div>;
  const text = status === 'saved' ? `✓ Saved on this phone${at && !compact ? ` · ${when(at)}` : ''}` : status === 'saving' ? 'Saving…' : '⚠ NOT SAVED YET. Retrying. Your last change is kept in a safety copy.';
  return <div className={`small-text ${status === 'failed' ? 'save-failed' : 'muted'}`} data-testid="save-status" data-state={status} role="status">{text}</div>;
}

const ACTION: Record<RestoreItem['action'], string> = {
  new: 'Will be added',
  replace: 'Will replace the older copy on this phone',
  same: 'Already the same, nothing to do',
  'keep-phone': 'Newer on this phone, will be kept as it is',
};

function RestorePreview({ data, title, onClose, onDone }: { data: BackupData; title: string; onClose: () => void; onDone: (msg: string) => void }) {
  const live = Object.values(useStore.getState().projects);
  const items = planRestore(data, live);
  const todo = items.filter((i) => i.action === 'new' || i.action === 'replace').length;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="stack" data-testid="restore-preview">
        <p className="small-text muted" style={{ margin: 0 }}>Made {when(data.createdAt)}. Nothing newer on this phone is replaced. Anything replaced gets a recovery point first.</p>
        {items.map((i) => (
          <div key={i.project.id} className="card" data-testid="restore-item" data-action={i.action}>
            <b>{i.name}</b>
            <div className="small-text">{ACTION[i.action]}</div>
          </div>
        ))}
        {err && <div className="warnbox review-box">{err}</div>}
        <button
          className="btn primary"
          disabled={!todo || busy}
          data-testid="restore-apply"
          onClick={async () => {
            setBusy(true);
            try {
              await flushWrites();
              const r = await applyRestore(data, items);
              onDone(`✓ Restored ${r.restored} project${r.restored === 1 ? '' : 's'}${r.kept ? `; ${r.kept} left as they were` : ''}.`);
            } catch (e) {
              setErr(`⚠ ${(e as Error).message}`);
              setBusy(false);
            }
          }}
        >
          {todo ? `RESTORE ${todo} PROJECT${todo === 1 ? '' : 'S'}` : 'NOTHING TO RESTORE'}
        </button>
      </div>
    </Sheet>
  );
}

function CheckpointRow({ cp, onDone }: { cp: Checkpoint; onDone: (m: string) => void }) {
  const cur = useStore((s) => s.projects[cp.projectId]);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const ahead = cur ? (cur.rev ?? 0) - cp.rev : 0; // saved changes made since this point
  return (
    <div className="card" data-testid="checkpoint">
      <button style={{ background: 'none', border: 0, padding: 0, font: 'inherit', textAlign: 'left', width: '100%' }} onClick={() => setOpen((o) => !o)}>
        <b>{cp.project.name}</b> · {when(cp.createdAt)}
        <div className="small-text muted">{cp.reason} · {stepsTicked(cp.project)} steps ticked · last worked {when(cp.project.lastWorkedAt ?? cp.createdAt)}</div>
      </button>
      {open && (
        <div className="stack" style={{ marginTop: 8 }}>
          <div className="small-text">{!cur ? 'This project is not in the library now. Restoring adds it back.' : `${ahead > 0 ? `You have made ${ahead} change${ahead === 1 ? '' : 's'} since this point. Restoring moves you BACK.` : 'Nothing has changed since this point.'} A recovery point of the current state is saved first, so you can undo.`}</div>
          <ConfirmButton className="btn soft" label="Restore this point" confirmLabel="Tap again to restore" onConfirm={() => void restoreCheckpoint(cp).then(onDone, (e) => setErr(`⚠ ${(e as Error).message}`))} />
          {err && <div className="small-text">{err}</div>}
        </div>
      )}
    </div>
  );
}

function RecoveryPoints({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) {
  const projects = useStore((s) => s.projects);
  const [cps, setCps] = useState<Checkpoint[]>();
  const [gone, setGone] = useState<Checkpoint[]>([]);
  const [legacy, setLegacy] = useState<BackupData>();
  const [showLegacy, setShowLegacy] = useState(false);
  const reload = () => {
    void history.list().then(setCps);
    void listRecoverable().then(setGone);
  };
  useEffect(() => {
    reload();
    void readLegacySnapshot().then(setLegacy);
  }, []);
  return (
    <Sheet title="Recovery points" onClose={onClose}>
      <div className="stack" data-testid="recovery-points">
        <p className="small-text muted" style={{ margin: 0 }}>Copies of your projects, kept automatically while you knit. Nothing is deleted except very old duplicates.</p>
        <button className="btn soft" data-testid="checkpoint-now" onClick={async () => { for (const id of Object.keys(projects)) await checkpointNow(id, 'manual'); reload(); }}>Save a recovery point now</button>
        {gone.length > 0 && (
          <div className="stack" data-testid="recoverable">
            <span className="caps">PROJECTS NOT IN THE LIBRARY</span>
            {gone.map((c) => <CheckpointRow key={c.id} cp={c} onDone={(m) => { onDone(m); reload(); }} />)}
          </div>
        )}
        <span className="caps">ALL RECOVERY POINTS</span>
        {!cps ? <div className="small-text">Loading…</div> : cps.length === 0 ? <div className="small-text" data-testid="no-checkpoints">None yet.</div> : cps.map((c) => <CheckpointRow key={c.id} cp={c} onDone={(m) => { onDone(m); reload(); }} />)}
        {legacy && <button className="btn ghost" data-testid="legacy-snapshot" onClick={() => setShowLegacy(true)}>Older automatic copy from {when(legacy.createdAt)} ({legacy.projects.length} projects)</button>}
        {showLegacy && legacy && <RestorePreview data={legacy} title="Older automatic copy" onClose={() => setShowLegacy(false)} onDone={(m) => { setShowLegacy(false); onDone(m); reload(); }} />}
      </div>
    </Sheet>
  );
}

/** Save status, backup file, restore and recovery points. */
export function BackupPanel() {
  const projects = useStore((s) => s.projects);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [verify, setVerify] = useState<VerifyReport>();
  const [preview, setPreview] = useState<BackupData>();
  const [points, setPoints] = useState(false);
  const [persisted, setPersisted] = useState<boolean | undefined>();
  const [, bump] = useState(0);
  const checkInput = useRef<HTMLInputElement>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  const count = Object.keys(projects).length;
  const awaitingCheck = lastExportAt() > lastVerifiedBackupAt();

  useEffect(() => {
    void requestPersistence().then(() => isPersisted()).then(setPersisted);
  }, []);

  const done = (m: string) => {
    setMsg(m);
    bump((n) => n + 1);
  };

  return (
    <section className="card stack" data-testid="backup-panel" style={{ margin: '16px 20px 0' }}>
      <span className="caps">SAVING AND BACKUP</span>
      <SaveStatus />
      {backupDue() && count > 0 && !awaitingCheck && <div className="jobs plain" data-testid="backup-due">⚠ No checked backup file in the last day. Tap SAVE BACKUP FILE, then CHECK SAVED FILE.</div>}
      <div className="small-text" data-testid="backup-status">
        <div>Backup file last checked and OK: {lastVerifiedBackupAt() ? when(lastVerifiedBackupAt()) : 'never'}</div>
        <div>Protection from iOS clearing app data: {persisted === undefined ? 'unknown' : persisted ? 'requested and granted' : 'not granted'}</div>
      </div>
      <button
        className="btn primary"
        disabled={busy || count === 0}
        data-testid="backup-save"
        onClick={async () => {
          setBusy(true);
          setVerify(undefined);
          try {
            await flushWrites();
            const r = await saveBackupFile(repo, Object.values(useStore.getState().projects));
            done(r === 'cancelled' ? 'Cancelled. No file was made.' : 'The file was handed to the share sheet. It is NOT counted as a backup until you tap CHECK SAVED FILE and pick it from Files.');
          } catch (e) {
            done(`⚠ ${(e as Error).message}`);
          }
          setBusy(false);
        }}
      >
        SAVE BACKUP FILE
      </button>
      <button className="btn soft" disabled={busy} data-testid="backup-check" onClick={() => checkInput.current?.click()}>CHECK SAVED FILE</button>
      <input ref={checkInput} type="file" accept="application/json,.json" hidden data-testid="backup-check-input" onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        setBusy(true);
        const r = await verifyBackupFile(f, Object.values(useStore.getState().projects), lastExportAt(), async (id) => !!(await repo.getFile(id)));
        setVerify(r);
        done(r.ok ? `✓ Checked: this file holds ${r.projects} project${r.projects === 1 ? '' : 's'}, made ${when(r.createdAt)}.${r.newerOnPhone.length ? ` Progress on ${r.newerOnPhone.join(', ')} has changed since. Make a new backup later.` : ''}` : '⚠ This file is NOT a good backup.');
        setBusy(false);
      }} />
      {verify && !verify.ok && <ul className="small-text" data-testid="verify-problems">{verify.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
      {verify && verify.ok && verify.warnings.length > 0 && <ul className="small-text muted" data-testid="verify-warnings">{verify.warnings.map((p, i) => <li key={i}>{p}</li>)}</ul>}
      <div className="row wrap">
        <button className="btn soft" disabled={busy} data-testid="backup-restore-file" onClick={() => restoreInput.current?.click()}>Restore from file</button>
        <button className="btn soft" data-testid="open-recovery" onClick={() => setPoints(true)}>Recovery points</button>
      </div>
      <input ref={restoreInput} type="file" accept="application/json,.json" hidden data-testid="backup-file-input" onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        try {
          setPreview(await readBackupFile(f));
        } catch (err) {
          done(`⚠ ${(err as Error).message}`);
        }
      }} />
      {msg && <div className="small-text" data-testid="backup-msg" role="status">{msg}</div>}
      <p className="tiny muted" style={{ margin: 0 }}>Everything above is stored on this phone. A backup file kept in Files or iCloud is what survives iOS clearing this app's data. An iPhone web app cannot write that file by itself, so it needs your tap.</p>
      {preview && <RestorePreview data={preview} title="Restore from file" onClose={() => setPreview(undefined)} onDone={(m) => { setPreview(undefined); done(m); }} />}
      {points && <RecoveryPoints onClose={() => setPoints(false)} onDone={done} />}
    </section>
  );
}
