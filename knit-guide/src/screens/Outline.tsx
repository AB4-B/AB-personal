import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CounterCard, StitchCounterCard } from '../components/Counters';
import { InstructionSheet, startSuggestion, suggestionTarget, suggestionsFor } from '../components/InstructionSheet';
import { NoteCard, NoteComposer } from '../components/Notes';
import { GuidedText, RichText, useAbbrSheet } from '../components/RichText';
import { ResolutionBanner, useResolver } from '../components/Resolver';
import { TrackerCard } from '../components/TrackerCard';
import { guideInstruction, sectionVisible } from '../model/guide';
import { projectFacts } from '../model/facts';
import { counterText, findInstruction, formatWhen, guideCtxOf, guideNotes, isActionable, isTextSource } from '../model/helpers';
import type { Instruction, Pattern, PatternImage, Project, Section } from '../model/types';
import { attachStopNote, finishAndAdvance, quickStop, setExpanded, toggleComplete, useStore } from '../store/store';
import { IconChevron, IconPdf, IconPin, IconPlus, IconStop, Sheet, ToastHost, TopBar, toast, useBlobUrl } from '../ui/common';
import { go, useRoute } from '../ui/router';

/* ------------------------------------------------------------- helpers */

function useIsVisible(id: string | undefined, deps: unknown[]) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (!id) return;
    let raf = 0;
    const check = () => {
      raf = 0;
      const el = document.getElementById(`ins-${id}`);
      if (!el) return setVisible(false);
      const r = el.getBoundingClientRect();
      setVisible(r.top > 40 ? r.top < window.innerHeight - 140 : r.bottom > 140);
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(check); };
    check();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    const t = window.setInterval(on, 600);
    return () => {
      window.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
      window.clearInterval(t);
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, ...deps]);
  return visible;
}

function scrollToIns(id: string, smooth = true) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.getElementById(`ins-${id}`)?.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
  }));
}

function ImgTile({ project, im }: { project: Project; im: PatternImage }) {
  const url = useBlobUrl(im.fileId);
  return (
    <button className="tile" onClick={() => go(`/p/${project.id}/chart/${im.id}`)} data-testid="chart-tile">
      {url ? <img src={url} alt={im.title} /> : <div style={{ height: 90 }} className="placeholder-img">…</div>}
      <b className="small-text">{im.title}</b>
      <span className="tiny muted">page {im.page}</span>
    </button>
  );
}

/* ------------------------------------------------------------- sections */

function Collapsible({ id, title, open, onToggle, count, level2, children, testId }: { id: string; title: string; open: boolean; onToggle: () => void; count?: string; level2?: boolean; children: React.ReactNode; testId?: string }) {
  return (
    <section className={`sec ${open ? 'open' : ''} ${level2 ? 'l2' : ''}`} data-section={id} data-testid={testId ?? 'section'}>
      <button className="sec-head" onClick={onToggle} aria-expanded={open}>
        <IconChevron />
        <span className="grow">{title}</span>
        {count && <span className="count">{count}</span>}
      </button>
      {open && <div className="sec-body">{children}</div>}
    </section>
  );
}

function InsRow({ project, pattern, ins, current, onOpen, onViewOriginal }: { project: Project; pattern: Pattern; ins: Instruction; current: boolean; onOpen: (i: Instruction, view?: 'menu' | 'original') => void; onViewOriginal: (id: string) => void }) {
  const { setTerm, sheet } = useAbbrSheet();
  const resolver = useResolver(project, pattern);
  const gctx = guideCtxOf(pattern, project);
  const done = project.progress.completed.includes(ins.id);
  const counters = project.counters.filter((c) => c.instructionId === ins.id);
  const stitch = project.stitchCounters.filter((c) => c.instructionId === ins.id);
  const notes = project.notes.filter((n) => n.scope.type === 'instruction' && n.scope.instructionId === ins.id);
  const mods = project.modifications.filter((m) => m.instructionId === ins.id);
  const spec = ins.trackerId ? pattern.trackers.find((t) => t.id === ins.trackerId) : undefined;
  const suggestions = current ? suggestionsFor(ins, pattern) : [];

  return (
    <div className="ins-wrap" id={`ins-${ins.id}`} data-ins={ins.id} data-current={current || undefined}>
      <div className={`ins ${ins.kind === 'info' ? 'info' : ''} ${done ? 'done' : ''} ${current ? 'current' : ''}`} data-testid="instruction">
        {isActionable(ins) ? (
          <button className="check" aria-label={done ? 'Mark not done' : 'Mark done'} aria-pressed={done} onClick={() => toggleComplete(project.id, ins.id)}><i>{done ? '✓' : ''}</i></button>
        ) : <span style={{ width: 8 }} />}
        <div
          className="body"
          role="button"
          tabIndex={0}
          onClick={() => onOpen(ins)}
          onContextMenu={(e) => { e.preventDefault(); onOpen(ins); }}
          onKeyDown={(e) => e.key === 'Enter' && onOpen(ins)}
        >
          {current && <span className="now-tag">NOW KNITTING</span>}
          {ins.kind === 'tracker' ? (
            <span><span className="badge gen">Generated</span> <b>{ins.text}</b>{spec && spec.review.length > 0 && <> <span className="badge review">NEEDS REVIEW</span></>}</span>
          ) : ins.kind === 'stitch-pattern' ? (
            <span className="pre"><b>{ins.text.split('\n')[0]}</b>{'\n'}<RichText text={ins.text.split('\n').slice(1).join('\n')} pattern={pattern} onTerm={setTerm} /></span>
          ) : (
            <GuidedText ins={ins} ctx={gctx} onTerm={setTerm} onResolve={resolver.open} />
          )}
          {guideNotes(ins).length > 0 && ins.kind !== 'tracker' && <> <span className="badge review" data-testid="review-badge">NEEDS REVIEW</span></>}
          {mods.map((m) => <div key={m.id} className="mod"><span className="pat-label mine">My modification</span>{m.text}</div>)}
          {(counters.length > 0 || stitch.length > 0 || notes.length > 0 || ins.source.imageIds.length > 0) && !current && (
            <div className="chips">
              {stitch.map((c) => <span key={c.id} className={`chip ${c.total >= c.target ? 'ok' : ''}`}>{c.total}/{c.target} sts</span>)}
              {counters.map((c) => <span key={c.id} className={`chip ${c.target && c.value >= c.target ? 'ok' : ''}`}>{counterText(c)}</span>)}
              {notes.length > 0 && <span className="chip">📝 {notes.length}</span>}
              {ins.source.imageIds.slice(0, 4).map((id) => <span key={id} className="chip">📈 {pattern.images.find((i) => i.id === id)?.title}</span>)}
            </div>
          )}
        </div>
        <button className="plus" aria-label="Instruction actions" onClick={() => onOpen(ins)} data-testid="plus"><IconPlus /></button>
      </div>

      {current && (
        <div className="live" data-testid="live-panel">
          {spec && <TrackerCard project={project} pattern={pattern} spec={spec} onViewOriginal={onViewOriginal} />}
          {stitch.map((c) => <StitchCounterCard key={c.id} projectId={project.id} counter={c} />)}
          {counters.map((c) => <CounterCard key={c.id} projectId={project.id} counter={c} />)}
          {notes.map((n) => <NoteCard key={n.id} project={project} pattern={pattern} note={n} showScope={false} />)}
          {suggestions.length > 0 && stitch.length + counters.length === 0 && (
            <div className="chips" style={{ marginTop: 0 }}>
              {suggestions.map((s, i) => {
                const t = suggestionTarget(s, ins, pattern, project);
                return <button key={i} className="chip suggest" onClick={() => startSuggestion(project, pattern, ins, s)}>{s.kind === 'stitch' ? `START STITCH COUNTER: ${t ?? '?'}` : `${s.kind === 'times' ? 'REPEAT' : s.kind === 'rows' ? 'ROW' : 'ROUND'} COUNTER${t ? `: ${t}` : ''}`}</button>;
              })}
            </div>
          )}
          <button className="btn primary block big" onClick={() => { const n = finishAndAdvance(project.id, ins.id); if (n) scrollToIns(n.id); else toast('Pattern finished'); }} data-testid="done-next">DONE · NEXT ▶</button>
          <button className="btn soft block" onClick={() => onOpen(ins)}>Counters · notes · explain</button>
        </div>
      )}
      {sheet}
      {resolver.sheet}
    </div>
  );
}

/* ------------------------------------------------------------- main */

export function Outline({ projectId }: { projectId: string }) {
  const project = useStore((s) => s.projects[projectId]);
  const pattern = useStore((s) => (project ? s.patterns[project.patternId] : undefined));
  const route = useRoute();
  const [sheet, setSheet] = useState<{ id: string; view?: 'menu' | 'original' }>();
  const [stopOpen, setStopOpen] = useState(false);
  const [secNote, setSecNote] = useState<string>();
  const [stopNote, setStopNote] = useState('');
  const { setTerm, sheet: abbrSheet } = useAbbrSheet();
  const focused = useRef(false);

  const currentId = project?.progress.currentInstructionId;
  const visible = useIsVisible(currentId, [project?.progress.expanded.length]);

  useLayoutEffect(() => {
    if (!project || focused.current) return;
    focused.current = true;
    if (route.query.get('focus') && currentId) scrollToIns(currentId, false);
  }, [project, currentId, route.query]);

  const toCurrent = useCallback(() => {
    if (!project || !pattern || !currentId) return;
    const ins = findInstruction(pattern, currentId);
    if (!ins) return;
    const sec = pattern.sections.find((s) => s.id === ins.sectionId);
    for (const sid of [sec?.id, sec?.parentId]) if (sid && !project.progress.expanded.includes(sid)) setExpanded(project.id, sid, true);
    scrollToIns(currentId);
  }, [project, pattern, currentId]);

  if (!project || !pattern) return <div className="screen"><TopBar title="Instructions" onBack={() => go('/')} /></div>;

  const exp = new Set(project.progress.expanded);
  const toggle = (id: string) => setExpanded(project.id, id, !exp.has(id));
  const sheetIns = sheet ? findInstruction(pattern, sheet.id) : undefined;
  const gctx = guideCtxOf(pattern, project);
  const facts = projectFacts(pattern, project.size);
  const charts = pattern.images.filter((i) => i.kind === 'chart');
  const diagrams = pattern.images.filter((i) => i.kind === 'diagram' || i.kind === 'photo');

  const renderSection = (sec: Section, children: Section[]) => {
    if (!sectionVisible(sec, project.size)) return null;
    const parent = pattern.sections.find((x) => x.id === sec.parentId);
    if (parent && !sectionVisible(parent, project.size)) return null;
    const list = pattern.instructions.filter((i) => i.sectionId === sec.id && (i.kind === 'tracker' || !guideInstruction(i, gctx).hidden));
    const total = list.filter(isActionable).length;
    const done = list.filter((i) => isActionable(i) && project.progress.completed.includes(i.id)).length;
    return (
      <Collapsible key={sec.id} id={sec.id} title={sec.title} open={exp.has(sec.id)} onToggle={() => toggle(sec.id)} count={total ? `${done}/${total}` : undefined} level2={sec.level === 2}>
        {project.notes.filter((n) => n.scope.type === 'section' && n.scope.sectionId === sec.id).map((n) => (
          <div key={n.id} style={{ padding: '8px 10px', borderTop: '1px solid var(--line)' }}><NoteCard project={project} pattern={pattern} note={n} showScope={false} /></div>
        ))}
        {list.map((ins) => (
          <InsRow key={ins.id} project={project} pattern={pattern} ins={ins} current={currentId === ins.id} onOpen={(i, v) => setSheet({ id: i.id, view: v })} onViewOriginal={(id) => setSheet({ id, view: 'original' })} />
        ))}
        <div className="sec-note"><button className="btn small ghost" onClick={() => setSecNote(sec.id)} data-testid="section-note-btn">📝 Add note to “{sec.title}”</button></div>
        {children.map((c) => renderSection(c, []))}
      </Collapsible>
    );
  };

  const topLevel = pattern.sections.filter((s) => s.level === 1 && sectionVisible(s, project.size));
  const noteCount = project.notes.length;

  return (
    <div className="screen">
      <TopBar
        title={pattern.title}
        onBack={() => go(`/p/${project.id}`)}
        right={<button className="iconbtn" aria-label={isTextSource(pattern) ? 'Original text' : 'Original PDF'} onClick={() => go(`/p/${project.id}/pdf`)} data-testid="topbar-pdf"><IconPdf /></button>}
      />
      <div className="outline" data-testid="outline">
        <div className="row wrap" style={{ padding: '0 4px 4px' }}>
          <span className="badge active">Size {project.size}</span>
          {project.progress.lastStop && <span className="tiny muted">Last stop {formatWhen(project.progress.lastStop.at)}</span>}
          {noteCount > 0 && <span className="tiny muted">· {noteCount} note{noteCount === 1 ? '' : 's'}</span>}
        </div>
        <ResolutionBanner project={project} pattern={pattern} />

        <Collapsible id="data" title="Project Data" open={exp.has('data')} onToggle={() => toggle('data')} testId="section-data">
          <div style={{ padding: 14 }}>
            <dl className="kv" data-testid="project-data">
              <dt>Size</dt><dd><b>{project.size}</b></dd>
              {facts.measurements.map((m) => (
                <Fragment key={m.label}><dt>{m.label}</dt><dd>{m.value}</dd></Fragment>
              ))}
              {facts.needles && (<><dt>Needles</dt><dd>{facts.needles}</dd></>)}
              {facts.gauge && (<><dt>Gauge</dt><dd>{facts.gauge}</dd></>)}
              {facts.yarn && (<><dt>Yarn required</dt><dd>{facts.yarn}</dd></>)}
              <dt>My yarn</dt><dd>{[project.setup.yarn, project.setup.colour].filter(Boolean).join(' · ') || '—'}</dd>
              <dt>My needles</dt><dd>{project.setup.needle || '—'}</dd>
              <dt>Lengths</dt><dd>Body {project.setup.bodyLength || '—'} · Sleeve {project.setup.sleeveLength || '—'}</dd>
            </dl>
            {facts.flags.length > 0 && <div className="warnbox" style={{ marginTop: 8 }} data-testid="measurement-review"><b>⚠ MEASUREMENT NEEDS REVIEW</b>{facts.flags.map((f, i) => <div key={i}>{f}</div>)}</div>}
            {project.modifications.filter((m) => !m.instructionId).map((m) => <div key={m.id} className="mod"><span className="pat-label mine">My modification</span>{m.text}</div>)}
          </div>
        </Collapsible>

        <Collapsible id="ref" title="For Reference" open={exp.has('ref')} onToggle={() => toggle('ref')} testId="section-ref">
          <Collapsible id="ref-charts" title="Charts" count={String(charts.length)} open={exp.has('ref-charts')} onToggle={() => toggle('ref-charts')} level2 testId="section-charts">
            <div className="hscroll" style={{ padding: 12 }}>{charts.map((im) => <ImgTile key={im.id} project={project} im={im} />)}{charts.length === 0 && <span className="muted">No charts found.</span>}</div>
          </Collapsible>
          <Collapsible id="ref-diagrams" title="Diagrams & images" count={String(diagrams.length)} open={exp.has('ref-diagrams')} onToggle={() => toggle('ref-diagrams')} level2 testId="section-diagrams">
            <div className="hscroll" style={{ padding: 12 }}>{diagrams.map((im) => <ImgTile key={im.id} project={project} im={im} />)}{diagrams.length === 0 && <span className="muted">None.</span>}</div>
          </Collapsible>
          <Collapsible id="ref-abbr" title="Abbreviations" count={String(pattern.abbreviations.length)} open={exp.has('ref-abbr')} onToggle={() => toggle('ref-abbr')} level2 testId="section-abbr">
            <div style={{ padding: '6px 14px 12px' }}>
              {pattern.abbreviations.map((a) => (
                <button key={a.abbr} className="row" style={{ width: '100%', minHeight: 48, background: 'none', border: 0, borderTop: '1px solid var(--line)', textAlign: 'left' }} onClick={() => setTerm({ key: a.abbr.toLowerCase(), display: a.abbr, fromPattern: a.definition, builtin: undefined })}>
                  <b style={{ width: 70 }}>{a.abbr}</b><span className="grow small-text">{a.definition}</span>
                </button>
              ))}
            </div>
          </Collapsible>
        </Collapsible>

        {topLevel.map((s) => renderSection(s, pattern.sections.filter((c) => c.level === 2 && c.parentId === s.id)))}
      </div>

      <div className="dock">
        {currentId && !visible && (
          <button className="btn to-current" onClick={toCurrent} data-testid="to-current"><IconPin /> TO CURRENT INSTRUCTION</button>
        )}
        <button
          className="btn stop"
          data-testid="quick-stop"
          onClick={() => { quickStop(project.id); setStopNote(''); setStopOpen(true); }}
        >
          <IconStop /> QUICK STOP
        </button>
      </div>

      {sheetIns && <InstructionSheet key={`${sheetIns.id}-${sheet?.view}`} project={project} pattern={pattern} ins={sheetIns} initialView={sheet?.view} onClose={() => setSheet(undefined)} />}
      {stopOpen && (
        <Sheet title="Stopping point saved" onClose={() => setStopOpen(false)}>
          <div className="done-banner" data-testid="stop-saved">✓ SAVED {formatWhen(project.progress.lastStop?.at)}</div>
          <p className="muted" style={{ margin: 0 }}>{project.progress.lastStop?.position ?? 'Position saved'}. Everything is stored on this device.</p>
          <div className="field"><label htmlFor="sn">Quick note (optional)</label><textarea id="sn" className="textarea" value={stopNote} onChange={(e) => setStopNote(e.target.value)} placeholder="e.g. Stopped after second marker." data-testid="stop-note" /></div>
          <div className="row">
            <button className="btn primary grow" onClick={() => { if (stopNote.trim()) attachStopNote(project.id, stopNote); setStopOpen(false); toast('Stopped. See you next time.'); }} data-testid="stop-done">{stopNote.trim() ? 'SAVE NOTE & DONE' : 'DONE'}</button>
          </div>
        </Sheet>
      )}
      {secNote && (
        <Sheet title="Section note" onClose={() => setSecNote(undefined)}>
          <p className="muted" style={{ margin: 0 }}>{pattern.sections.find((x) => x.id === secNote)?.title}</p>
          <NoteComposer projectId={project.id} scope={{ type: 'section', sectionId: secNote }} onSaved={() => { toast('Note saved'); setSecNote(undefined); }} />
        </Sheet>
      )}
      {abbrSheet}
      <ToastHost />
    </div>
  );
}
