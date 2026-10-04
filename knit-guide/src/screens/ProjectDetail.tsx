import { useState } from 'react';
import { NoteCard, NoteComposer } from '../components/Notes';
import { resumeInfo } from '../components/Summary';
import { findInstruction, sourceLabel } from '../model/helpers';
import { addModification, deleteModification, editModification, renameProject, setPhoto, setSize, setStatus, updateSetup, useStore } from '../store/store';
import type { Modification, Pattern, Project, ProjectSetup } from '../model/types';
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
  ['yarn', 'Yarn'], ['colour', 'Colour'], ['needle', 'Needle size'], ['gaugeSts', 'Gauge: stitches / 4"'], ['gaugeRows', 'Gauge: rows / 4"'], ['bodyLength', 'Body length'], ['sleeveLength', 'Sleeve length'],
];

function EditSetup({ project, pattern, onClose }: { project: Project; pattern: Pattern; onClose: () => void }) {
  const [name, setName] = useState(project.name);
  const [size, setSz] = useState(project.size);
  const [s, setS] = useState(project.setup);
  const [status, setSt] = useState(project.status);
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
        {size !== project.size && <div className="warnbox">Changing size changes every resolved number. Counters you already set keep their old targets.</div>}
      </div>
      <div className="field">
        <label>Status</label>
        <div className="chips" style={{ marginTop: 0 }}>
          {([['not-started', 'Not started'], ['active', 'Active'], ['finished', 'Finished']] as const).map(([k, n]) => <button key={k} className={`chip ${status === k ? 'ok' : ''}`} onClick={() => setSt(k)}>{n}</button>)}
        </div>
      </div>
      {FIELDS.map(([k, label]) => (
        <div className="field" key={k}><label htmlFor={`f-${k}`}>{label}</label><input id={`f-${k}`} className="input" value={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.value })} /></div>
      ))}
      <button className="btn primary" onClick={() => {
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

  if (!project || !pattern) return <div className="screen"><TopBar title="Project" onBack={() => go('/')} /><div className="empty">Project not found.</div></div>;

  const resume = resumeInfo(project, pattern);
  const sizeIdx = pattern.sizes.indexOf(project.size);
  const measurement = pattern.measurements[0];
  const chest = measurement?.inches?.[sizeIdx];
  const chestCm = measurement?.cm?.[sizeIdx];

  return (
    <div className="screen">
      <TopBar title={project.name} onBack={() => go('/')} right={<button className="iconbtn" aria-label="Edit details" onClick={() => setEditing(true)}><IconMore /></button>} />
      <div className="page-pad stack" style={{ gap: 16 }}>
        {resume ? (
          <button className="continue" onClick={() => go(`/p/${project.id}/outline?focus=1`)} data-testid="continue-card">
            <span className="caps" style={{ color: '#e5d6ee' }}>Where you stopped</span>
            <span className="where" data-testid="resume-section">{resume.section}</span>
            <span>{resume.snippet}</span>
            {resume.position && <span className="where" data-testid="resume-position">{resume.position}</span>}
            <span style={{ opacity: .85 }}>Last worked:<br /><b data-testid="resume-when">{resume.when}</b></span>
            {resume.note && <span className="quote" data-testid="resume-note">Last note: “{resume.note}”</span>}
            <span className="cta">CONTINUE KNITTING</span>
          </button>
        ) : (
          <button className="btn primary big block" onClick={() => go(`/p/${project.id}/outline`)} data-testid="start-knitting">START KNITTING</button>
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
            <dt>Size</dt><dd data-testid="detail-size"><b>{project.size}</b>{chest ? ` · ${measurement?.label.toLowerCase()} ${chest} in${chestCm ? ` (${chestCm} cm)` : ''}` : ''}</dd>
          </dl>
        </section>

        <section className="card stack">
          <h2>Yarn, needles, gauge</h2>
          <dl className="kv">
            <dt>Yarn</dt><dd>{project.setup.yarn || '—'}</dd>
            <dt>Colour</dt><dd>{project.setup.colour || '—'}</dd>
            <dt>Needles</dt><dd>{project.setup.needle || '—'}</dd>
            <dt>Pattern gauge</dt><dd>{pattern.gauge.raw || '—'}</dd>
            <dt>My gauge</dt><dd>{project.setup.gaugeSts || project.setup.gaugeRows ? `${project.setup.gaugeSts || '?'} sts × ${project.setup.gaugeRows || '?'} rows / 4"` : 'Not entered'}</dd>
            <dt>Body length</dt><dd>{project.setup.bodyLength || '—'}</dd>
            <dt>Sleeve length</dt><dd>{project.setup.sleeveLength || '—'}</dd>
          </dl>
          <button className="btn soft" onClick={() => setEditing(true)}>Edit details</button>
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
