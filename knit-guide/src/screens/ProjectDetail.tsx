import { Fragment, useEffect, useState } from 'react';
import { NoteCard, NoteComposer } from '../components/Notes';
import { resumeInfo } from '../components/Summary';
import { projectFacts } from '../model/facts';
import { analyzeResolution } from '../model/guide';
import { gaugeCheck } from '../model/gauge';
import { findInstruction, hasProgress, sourceLabel } from '../model/helpers';
import { prefsOf } from '../guidance/flow';
import { setPrefs, addModification, deleteModification, editModification, renameProject, setPhoto, setSize, setStatus, updateSetup, useStore } from '../store/store';
import type { Modification, Pattern, Project, ProjectSetup } from '../model/types';
import { SaveStatus } from './Backup';
import { isStale, isUntouched, rereadPattern } from '../pdf/reread';
import { ConfirmButton, IconMore, IconPdf, PhotoInput, Sheet, ToastHost, TopBar, YarnIcon, useBlobUrl } from '../ui/common';
import { go } from '../ui/router';

function ModCard({ project, mod, pattern }: { project: Project; mod: Modification; pattern: Pattern }) {
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(mod.text);
  const ins = mod.instructionId ? findInstruction(pattern, mod.instructionId) : undefined;
  return (
    <div className="mod" data-testid="modification">
      <span className="pat-label mine">My modification{ins ? ` · ${ins.text.slice(0, 40)}…` : ' · whole project'}</span>
      {edit ? (
        <div className="stack">
          <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row">
            <button className="btn primary small" onClick={() => { editModification(project.id, mod.id, text.trim()); setEdit(false); }}>Save</button>
            <span className="grow" />
            <ConfirmButton label="Delete" onConfirm={() => deleteModification(project.id, mod.id)} />
          </div>
        </div>
      ) : (
        <div className="row"><div className="grow">{mod.text}</div><button className="btn ghost small" onClick={() => setEdit(true)}>Edit</button></div>
      )}
    </div>
  );
}

const FIELDS: [keyof ProjectSetup, string][] = [
  ['yarn', 'Yarn'], ['colour', 'Colour'], ['needle', 'Needle size'], ['gaugeSts', 'My swatch: stitches / 10 cm'], ['gaugeRows', 'My swatch: rows / 10 cm'], ['bodyLength', 'Body length'], ['sleeveLength', 'Sleeve length'],
];

function EditSetup({ project, pattern, onClose }: { project: Project; pattern: Pattern; onClose: () => void }) {
  const [name, setName] = useState(project.name);
  const [size, setSz] = useState(project.size);
  const [s, setS] = useState(project.setup);
  const [status, setSt] = useState(project.status);
  const [ack, setAck] = useState(false);
  const blocked = size !== project.size && hasProgress(project) && !ack;
  return (
    <Sheet title="Edit project details" onClose={onClose}>
      <div className="field"><label htmlFor="pn">Project name</label><input id="pn" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="field">
        <label>Size</label>
        <div className="size-pick">
          {pattern.sizes.map((z) => (
            <button key={z} className={`size-btn ${size === z ? 'on' : ''}`} onClick={() => setSz(z)}><b>{z}</b></button>
          ))}
        </div>
        {size !== project.size && (
          <div className="warnbox review-box" data-testid="size-change-warning">
            <b>⚠ Changing size changes the whole guide.</b>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              <li>Stitch counts, row counts and repeat counts will change.</li>
              <li>Counters you already started keep their old targets.</li>
              <li>{Object.keys(project.sizeOverrides ?? {}).length} size value{Object.keys(project.sizeOverrides ?? {}).length === 1 ? '' : 's'} you confirmed by hand will be cleared, and you will be asked again.</li>
            </ul>
            {hasProgress(project) && (
              <label className="row" style={{ minHeight: 48, marginTop: 6 }}>
                <input type="checkbox" style={{ width: 26, height: 26 }} checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="size-change-ack" />
                <span><b>Knitting has already started.</b> I understand and want to change size anyway.</span>
              </label>
            )}
          </div>
        )}
      </div>
      <div className="field">
        <label>Status</label>
        <div className="chips" style={{ marginTop: 0 }}>
          {([['not-started', 'Not started'], ['active', 'Active'], ['finished', 'Finished']] as const).map(([k, n]) => <button key={k} className={`chip ${status === k ? 'ok' : ''}`} onClick={() => setSt(k)}>{n}</button>)}
        </div>
      </div>
      <div className="field">
        <label>How I knit</label>
        <label className="row" style={{ minHeight: 48 }}>
          <input type="checkbox" style={{ width: 26, height: 26 }} defaultChecked={prefsOf(project).circular} onChange={(e) => setPrefs(project.id, { circular: e.target.checked })} data-testid="pref-circular" />
          <span>Preferred needles: circular (also for flat work)</span>
        </label>
        <div className="chips" style={{ marginTop: 0 }}>
          {([['magic-loop', 'Small circumference: Magic Loop'], ['dpn', 'Small circumference: DPNs']] as const).map(([k, n]) => (
            <button key={k} className={`chip ${prefsOf(project).smallCircumference === k ? 'ok' : ''}`} data-testid={`pref-${k}`} onClick={() => setPrefs(project.id, { smallCircumference: k })}>{n}</button>
          ))}
        </div>
      </div>
      {FIELDS.map(([k, label]) => (
        <div className="field" key={k}><label htmlFor={`f-${k}`}>{label}</label><input id={`f-${k}`} className="input" value={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.value })} /></div>
      ))}
      <button className="btn primary" disabled={blocked} data-testid="edit-save" onClick={() => {
        if (name.trim() && name !== project.name) renameProject(project.id, name.trim());
        if (size !== project.size) setSize(project.id, size);
        if (status !== project.status) setStatus(project.id, status);
        updateSetup(project.id, s);
        onClose();
      }}>SAVE</button>
    </Sheet>
  );
}

export function ProjectDetail({ projectId }: { projectId: string }) {
  const project = useStore((s) => s.projects[projectId]);
  const pattern = useStore((s) => (project ? s.patterns[project.patternId] : undefined));
  const [editing, setEditing] = useState(false);
  const [addingNote, setAddingNote] = useState(false);
  const [addingMod, setAddingMod] = useState(false);
  const [modText, setModText] = useState('');
  const photo = useBlobUrl(project?.photoId);
  const [reading, setReading] = useState(false);
  const [readMsg, setReadMsg] = useState('');
  const reread = async (p: Project) => {
    setReading(true);
    setReadMsg('');
    try {
      const r = await rereadPattern(p);
      setReadMsg(r.ok ? r.message : `⚠ ${r.message}`);
    } catch (e) {
      setReadMsg(`⚠ Could not re-read: ${(e as Error).message}`);
    }
    setReading(false);
  };
  // a project created with an older reader and not started yet is re-read automatically
  useEffect(() => {
    if (project && pattern && isStale(pattern) && isUntouched(project)) void reread(project);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, pattern?.readerVersion]);

  if (!project || !pattern) return <div className="screen"><TopBar title="Project" onBack={() => go('/')} /><div className="empty">Project not found.</div></div>;

  const resume = resumeInfo(project, pattern);
  const facts = projectFacts(pattern, project.size);
  const gc = gaugeCheck(pattern, project);
  const resolution = analyzeResolution(pattern, project.size, project.sizeOverrides ?? {});

  return (
    <div className="screen">
      <TopBar title={project.name} onBack={() => go('/')} right={<button className="iconbtn" aria-label="Edit details" onClick={() => setEditing(true)}><IconMore /></button>} />
      <div className="page-pad stack" style={{ gap: 16 }}>
        <SaveStatus />
        {resume ? (
          <button className="continue" onClick={() => go(`/p/${project.id}/knit`)} data-testid="continue-card">
            <span className="caps" style={{ color: 'rgba(255,255,255,.8)' }}>Where you stopped</span>
            <span className="where" data-testid="resume-section">{resume.section}</span>
            <span>{resume.snippet}</span>
            {resume.position && <span className="where" data-testid="resume-position">{resume.position}</span>}
            <span style={{ opacity: .85 }}>Last worked:<br /><b data-testid="resume-when">{resume.when}</b></span>
            {project.progress.lastStop?.state && (
              <span className="quote" data-testid="stopped-here">
                <b>YOU STOPPED HERE</b><br />
                {project.progress.lastStop.state.headline.join(' · ')}
                {project.progress.lastStop.state.stitches !== undefined && <><br />{project.progress.lastStop.state.stitches} stitches</>}
                {project.progress.lastStop.state.nextAction && <><br />Next: {project.progress.lastStop.state.nextAction}</>}
                {project.progress.lastStop.state.tracking.map((t) => <span key={t} style={{ display: 'block' }}>{t}</span>)}
              </span>
            )}
            {resume.note && <span className="quote" data-testid="resume-note">Last note: “{resume.note}”</span>}
            <span className="cta">CONTINUE KNITTING</span>
          </button>
        ) : (
          <button className="btn primary big block" onClick={() => go(`/p/${project.id}/knit`)} data-testid="start-knitting">START KNITTING</button>
        )}

        {photo ? <img className="hero-img" src={photo} alt={project.name} /> : <div className="placeholder-img"><YarnIcon size={72} /></div>}
        <div className="row wrap">
          <PhotoInput onPick={(b) => void setPhoto(project.id, b)}>{project.photoId ? 'Change photo' : 'Add photo'}</PhotoInput>
          {project.photoId && <button className="btn ghost" onClick={() => void setPhoto(project.id, null)}>Remove</button>}
        </div>

        <div className="row">
          <button className="btn primary grow" onClick={() => go(`/p/${project.id}/outline`)} data-testid="open-instructions">INSTRUCTIONS</button>
          <button className="btn grow" onClick={() => go(`/p/${project.id}/pdf`)} data-testid="open-pdf"><IconPdf /> {sourceLabel(pattern)}</button>
        </div>

        <section className="card stack">
          <h2>Pattern</h2>
          <dl className="kv">
            <dt>Pattern</dt><dd>{pattern.title}</dd>
            <dt>Designer</dt><dd>{pattern.designer || '—'}</dd>
            {pattern.difficulty && (<><dt>Level</dt><dd>{pattern.difficulty}</dd></>)}
            {pattern.notions && (<><dt>Notions</dt><dd>{pattern.notions}</dd></>)}
            <dt>Size</dt><dd data-testid="detail-size"><b>{project.size}</b>{facts.measurements[0] ? ` · ${facts.measurements[0].label.toLowerCase()} ${facts.measurements[0].value}` : ''}</dd>
            {facts.measurements.slice(1).map((m) => (<Fragment key={m.label}><dt>{m.label}</dt><dd>{m.value}</dd></Fragment>))}
            <dt>Size values</dt><dd data-testid="detail-resolution">{resolution.needsReview.length === 0 ? `✓ all resolved for size ${project.size}` : `⚠ ${resolution.needsReview.length} need review`}</dd>
          </dl>
        </section>

        <section className="card stack">
          <h2>Yarn, needles, gauge</h2>
          <dl className="kv">
            <dt>Yarn</dt><dd>{project.setup.yarn || '—'}</dd>
            <dt>Colour</dt><dd>{project.setup.colour || '—'}</dd>
            <dt>Needles</dt><dd>{project.setup.needle || '—'}</dd>
            {facts.needles && (<><dt>Pattern needles</dt><dd>{facts.needles}</dd></>)}
            <dt>Pattern gauge</dt><dd>{facts.gauge ?? '—'}</dd>
            {facts.yarn && (<><dt>Yarn required</dt><dd>{facts.yarn}</dd></>)}
            <dt>My gauge</dt><dd>{project.setup.gaugeSts || project.setup.gaugeRows ? `${project.setup.gaugeSts || '?'} sts × ${project.setup.gaugeRows || '?'} rows / 10 cm` : 'Not entered'}</dd>
            <dt>Body length</dt><dd>{project.setup.bodyLength || '—'}</dd>
            <dt>Sleeve length</dt><dd>{project.setup.sleeveLength || '—'}</dd>
          </dl>
          {gc.level === 'warn' && <div className="warnbox review-box" data-testid="gauge-warning"><b>⚠ GAUGE DIFFERS FROM THE PATTERN</b>{gc.lines.map((l, i) => <div key={i}>{l}</div>)}</div>}
          {gc.level === 'ok' && <div className="done-banner" data-testid="gauge-ok">✓ Swatch matches the pattern gauge</div>}
          {gc.level === 'none' && <p className="muted small-text" style={{ margin: 0 }} data-testid="gauge-none">{gc.lines[0]}</p>}
          <button className="btn soft" onClick={() => setEditing(true)}>Edit details</button>
          {isStale(pattern) && !isUntouched(project) && !reading && <div className="warnbox review-box" data-testid="reread-offer"><b>This pattern was read with an older reader.</b><div>Re-reading can fix scrambled text and size questions. Because you have started knitting, it is only done when your place cannot move, and a recovery point is saved first.</div></div>}
          <ConfirmButton className="btn soft" label={reading ? 'Re-reading…' : 'Re-read pattern from the saved PDF'} confirmLabel="Tap again to re-read" onConfirm={() => void reread(project)} />
          {readMsg && <div className="small-text" data-testid="reread-msg" role="status">{readMsg}</div>}
        </section>

        <section className="card stack">
          <h2>My modifications</h2>
          <p className="muted small-text" style={{ margin: 0 }}>Stored next to the pattern. The designer's instructions are never changed.</p>
          {project.modifications.map((m) => <ModCard key={m.id} project={project} mod={m} pattern={pattern} />)}
          {addingMod ? (
            <div className="stack">
              <textarea className="textarea" placeholder="e.g. Make this a long cardigan, mid-thigh." value={modText} onChange={(e) => setModText(e.target.value)} aria-label="New modification" />
              <button className="btn primary" disabled={!modText.trim()} onClick={() => { addModification(project.id, null, modText.trim()); setModText(''); setAddingMod(false); }}>SAVE MODIFICATION</button>
            </div>
          ) : (
            <button className="btn soft" onClick={() => setAddingMod(true)}>+ Add modification</button>
          )}
        </section>

        <section className="card stack">
          <h2>Notes</h2>
          {project.notes.length === 0 && <p className="muted" style={{ margin: 0 }}>No notes yet.</p>}
          {[...project.notes].sort((a, b) => b.createdAt - a.createdAt).map((n) => <NoteCard key={n.id} project={project} pattern={pattern} note={n} />)}
          {addingNote ? <NoteComposer projectId={project.id} scope={{ type: 'project' }} onSaved={() => setAddingNote(false)} /> : <button className="btn soft" onClick={() => setAddingNote(true)}>+ Add project note</button>}
        </section>
      </div>
      {editing && <EditSetup project={project} pattern={pattern} onClose={() => setEditing(false)} />}
      <ToastHost />
    </div>
  );
}
