import { useState } from 'react';
import { formatWhen, progressFraction } from '../model/helpers';
import type { Project } from '../model/types';
import { archiveProject, deleteProject, renameProject, setPhoto, useStore } from '../store/store';
import { ConfirmButton, IconMore, IconPlus, PhotoInput, Sheet, ToastHost, YarnIcon, useBlobUrl } from '../ui/common';
import { go } from '../ui/router';

const STATUS = { 'not-started': 'Not started', active: 'Active', finished: 'Finished' } as const;

function Thumb({ photoId }: { photoId?: string }) {
  const url = useBlobUrl(photoId);
  return url ? <img className="thumb" src={url} alt="" /> : <div className="thumb"><YarnIcon /></div>;
}

function ProjectMenu({ project, onClose }: { project: Project; onClose: () => void }) {
  const [name, setName] = useState(project.name);
  return (
    <Sheet title="Project" onClose={onClose}>
      <div className="field">
        <label htmlFor="rn">Name</label>
        <input id="rn" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn primary" disabled={!name.trim() || name === project.name} onClick={() => { renameProject(project.id, name.trim()); onClose(); }}>
          RENAME
        </button>
      </div>
      <div className="row wrap">
        <PhotoInput onPick={(b) => void setPhoto(project.id, b)}>{project.photoId ? 'Change photo' : 'Add photo'}</PhotoInput>
        {project.photoId && <button className="btn ghost" onClick={() => void setPhoto(project.id, null)}>Remove photo</button>}
      </div>
      <button className="btn soft" onClick={() => { archiveProject(project.id, !project.archived); onClose(); }}>
        {project.archived ? 'Unarchive' : 'Archive project'}
      </button>
      <ConfirmButton className="btn danger" label="Delete project…" confirmLabel="Tap again: delete project and its data" onConfirm={() => { void deleteProject(project.id); onClose(); }} />
      <p className="muted small-text">Deleting removes the project, its counters/notes and the stored PDF from this device only.</p>
    </Sheet>
  );
}

export function Home() {
  const projects = useStore((s) => s.projects);
  const patterns = useStore((s) => s.patterns);
  const [menu, setMenu] = useState<Project>();
  const [showArchived, setShowArchived] = useState(false);

  const all = Object.values(projects).sort((a, b) => (b.lastWorkedAt ?? b.createdAt) - (a.lastWorkedAt ?? a.createdAt));
  const visible = all.filter((p) => !!p.archived === showArchived);
  const resume = all.find((p) => p.status === 'active' && !p.archived && p.progress.currentInstructionId);

  return (
    <div className="screen">
      <div className="hero">
        <h1>Knit Guide</h1>
        <p className="muted">Your patterns, your place, always saved.</p>
      </div>

      {resume && !showArchived && (
        <div style={{ padding: '10px 16px 0' }}>
          <button className="continue" onClick={() => go(`/p/${resume.id}/outline?focus=1`)} data-testid="resume-active">
            <span className="caps" style={{ color: '#e5d6ee' }}>Resume active project</span>
            <span className="where">{resume.name}</span>
            <span style={{ opacity: .85 }}>Last worked: {formatWhen(resume.lastWorkedAt)}</span>
            <span className="cta">CONTINUE KNITTING</span>
          </button>
        </div>
      )}

      <div style={{ padding: '18px 20px 0' }} className="row">
        <span className="caps grow">{visible.length} {showArchived ? 'archived' : visible.length === 1 ? 'project' : 'projects'}</span>
        <button className="btn ghost small" onClick={() => setShowArchived((v) => !v)}>{showArchived ? 'Show active' : 'Show archived'}</button>
      </div>

      {visible.length === 0 ? (
        <div className="empty">
          <YarnIcon size={72} />
          <h2 style={{ margin: '12px 0 6px' }}>{showArchived ? 'Nothing archived' : 'No projects yet'}</h2>
          {!showArchived && <p>Upload a knitting pattern PDF and Knit Guide will turn it into a step-by-step project.</p>}
        </div>
      ) : (
        <div className="projects" data-testid="project-list">
          {visible.map((p) => {
            const pat = patterns[p.patternId];
            const frac = pat ? progressFraction(pat, p) : 0;
            return (
              <div key={p.id} className="pcard" data-testid="project-card">
                <button style={{ display: 'flex', gap: 14, flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 0, padding: 0 }} onClick={() => go(`/p/${p.id}`)}>
                  <Thumb photoId={p.photoId} />
                  <div className="grow stack" style={{ gap: 6 }}>
                    <div className="row"><span className={`badge ${p.status === 'not-started' ? '' : p.status}`}>{STATUS[p.status]}</span></div>
                    <h3>{p.name}</h3>
                    <div className="muted small-text">{pat?.title}{pat?.designer ? ` · ${pat.designer}` : ''}</div>
                    <div className="progress" aria-label={`Progress ${Math.round(frac * 100)}%`}><i style={{ width: `${frac * 100}%` }} /></div>
                    <div className="tiny muted">{Math.round(frac * 100)}% · Last worked {formatWhen(p.lastWorkedAt)}</div>
                  </div>
                </button>
                <button className="iconbtn" aria-label={`Options for ${p.name}`} onClick={() => setMenu(p)}><IconMore /></button>
              </div>
            );
          })}
        </div>
      )}

      <p className="tiny muted" style={{ textAlign: 'center', padding: '0 16px 90px', marginTop: -70 }} data-testid="build-stamp">Build {__BUILD__} · guided knit mode, single-size, metric-only</p>
      <button className="btn primary big fab" onClick={() => go('/new')} data-testid="new-project">
        <IconPlus /> NEW PROJECT
      </button>
      {menu && projects[menu.id] && <ProjectMenu project={projects[menu.id]} onClose={() => setMenu(undefined)} />}
      <ToastHost />
    </div>
  );
}
