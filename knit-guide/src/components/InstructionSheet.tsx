import { useState } from 'react';
import { detectSuggestions, type Suggestion } from '../parser/detect';
import { explain } from '../engine/explain';
import { findSizeGroups, resolveText, toNumber } from '../model/size';
import type { CounterKind, Instruction, Pattern, Project } from '../model/types';
import { addCounter, addModification, addStitchCounter, knitFromHere, toggleComplete } from '../store/store';
import { Sheet, toast } from '../ui/common';
import { go } from '../ui/router';
import { CounterCard, StitchCounterCard } from './Counters';
import { NoteCard, NoteComposer } from './Notes';
import { RichText, useAbbrSheet } from './RichText';

type View = 'menu' | 'explain' | 'original' | 'note' | 'counter' | 'stitch' | 'mod';

export function suggestionsFor(ins: Instruction, pattern: Pattern): Suggestion[] {
  const ignored = new Set(ins.ignoredSuggestions ?? []);
  return detectSuggestions(ins.text, pattern.sizes.length).filter((s) => !ignored.has(s.evidence));
}

/** Resolve a suggestion's target for the selected size (undefined when it cannot be resolved safely). */
export function suggestionTarget(s: Suggestion, sizeIndex: number): number | undefined {
  if (!s.perSize) return toNumber(s.values[0]);
  if (s.review) return undefined;
  return toNumber(s.values[sizeIndex]);
}

export function startSuggestion(project: Project, pattern: Pattern, ins: Instruction, s: Suggestion) {
  const idx = pattern.sizes.indexOf(project.size);
  const target = suggestionTarget(s, idx);
  if (s.kind === 'stitch') {
    if (target) addStitchCounter(project.id, ins.id, target, 10, s.label);
    else addCounter(project.id, ins.id, 'stitches', s.label);
  } else {
    const kind: CounterKind = s.kind;
    addCounter(project.id, ins.id, kind, s.label, target);
  }
  toast('Counter added');
}

export function InstructionSheet({ project, pattern, ins, onClose, initialView = 'menu' }: { project: Project; pattern: Pattern; ins: Instruction; onClose: () => void; initialView?: View }) {
  const [view, setView] = useState<View>(initialView);
  const [showOriginal, setShowOriginal] = useState(false);
  const { setTerm, sheet: abbrSheet } = useAbbrSheet();
  const sizeIndex = pattern.sizes.indexOf(project.size);
  const section = pattern.sections.find((s) => s.id === ins.sectionId);
  const isCurrent = project.progress.currentInstructionId === ins.id;
  const counters = project.counters.filter((c) => c.instructionId === ins.id);
  const stitchCounters = project.stitchCounters.filter((c) => c.instructionId === ins.id);
  const notes = project.notes.filter((n) => n.scope.type === 'instruction' && n.scope.instructionId === ins.id);
  const mods = project.modifications.filter((m) => m.instructionId === ins.id);
  const hasGroups = findSizeGroups(ins.text, pattern.sizes.length).length > 0;
  const suggestions = suggestionsFor(ins, pattern);
  const done = project.progress.completed.includes(ins.id);
  const goBack = view === 'menu' ? undefined : () => setView('menu');

  const titles: Record<View, string> = { menu: section?.title ?? 'Instruction', explain: 'Explain this', original: 'Original', note: 'Add note', counter: 'Add counter', stitch: 'Add stitch counter', mod: 'My modification' };

  const patternBlock = (
    <div className="card" data-testid="sheet-pattern">
      <span className="pat-label">Pattern</span>
      <RichText text={ins.text} pattern={pattern} sizeIndex={sizeIndex} original={showOriginal} onTerm={setTerm} />
      {hasGroups && (
        <div className="row" style={{ marginTop: 8 }}>
          <button className="chip" onClick={() => setShowOriginal((v) => !v)} data-testid="toggle-original">{showOriginal ? `Show size ${project.size}` : 'Original'}</button>
          <span className="tiny muted">{showOriginal ? 'Designer’s text, all sizes' : `Numbers for size ${project.size} highlighted`}</span>
        </div>
      )}
      {ins.review && <div className="warnbox" style={{ marginTop: 8 }}><span className="badge review">NEEDS REVIEW</span><br />{ins.review.join(' ')}</div>}
    </div>
  );

  return (
    <>
      <Sheet title={titles[view]} onClose={onClose} onBack={goBack}>
        {view === 'menu' && (
          <>
            {patternBlock}
            {mods.map((m) => (
              <div className="mod" key={m.id}><span className="pat-label mine">My modification</span>{m.text}</div>
            ))}
            {ins.source.imageIds.length > 0 && (
              <div className="chips">
                {ins.source.imageIds.map((id) => {
                  const im = pattern.images.find((i) => i.id === id);
                  return im ? <button key={id} className="chip" onClick={() => go(`/p/${project.id}/chart/${id}`)}>📈 {im.title}</button> : null;
                })}
              </div>
            )}
            {suggestions.length > 0 && (
              <div className="stack" style={{ gap: 6 }}>
                <span className="caps">Detected in this instruction</span>
                <div className="chips" style={{ marginTop: 0 }}>
                  {suggestions.map((s, i) => {
                    const t = suggestionTarget(s, sizeIndex);
                    return (
                      <button key={i} className="chip suggest" data-testid="suggestion" onClick={() => startSuggestion(project, pattern, ins, s)}>
                        {s.kind === 'stitch' ? `START STITCH COUNTER: ${t ?? '?'}` : `${s.kind === 'times' ? 'REPEAT' : s.kind === 'rows' ? 'ROW' : 'ROUND'} COUNTER${t ? `: ${t}` : ''}`}
                        {s.review && <span className="badge review" style={{ marginLeft: 6 }}>review</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="actions">
              <button className="btn primary big wide" onClick={() => { knitFromHere(project.id, ins.id); toast('Knitting from here'); onClose(); }} data-testid="knit-from-here">
                {isCurrent ? '✓ CURRENT · KNIT FROM HERE' : 'KNIT FROM HERE'}
              </button>
              <button className="btn" onClick={() => setView('note')} data-testid="act-note">ADD NOTE</button>
              <button className="btn" onClick={() => setView('counter')} data-testid="act-counter">ADD COUNTER</button>
              <button className="btn" onClick={() => setView('stitch')} data-testid="act-stitch">ADD STITCH COUNTER</button>
              <button className="btn" onClick={() => setView('explain')} data-testid="act-explain">EXPLAIN THIS</button>
              <button className="btn" onClick={() => setView('original')} data-testid="act-original">VIEW ORIGINAL</button>
              <button className="btn" onClick={() => setView('mod')}>MY MODIFICATION</button>
              {ins.kind === 'action' && <button className="btn soft wide" onClick={() => toggleComplete(project.id, ins.id)}>{done ? 'Mark as not done' : 'Mark as done'}</button>}
            </div>
            {stitchCounters.map((c) => <StitchCounterCard key={c.id} projectId={project.id} counter={c} />)}
            {counters.map((c) => <CounterCard key={c.id} projectId={project.id} counter={c} />)}
            {notes.length > 0 && (
              <div className="stack">
                <span className="caps">Notes on this instruction</span>
                {notes.map((n) => <NoteCard key={n.id} project={project} pattern={pattern} note={n} showScope={false} />)}
              </div>
            )}
          </>
        )}
        {view === 'explain' && <ExplainView ins={ins} pattern={pattern} project={project} sizeIndex={sizeIndex} />}
        {view === 'original' && (
          <div className="stack" data-testid="original-view">
            <div className="card">
              <span className="pat-label">Original pattern · PDF page {ins.source.page}</span>
              <div className="pre">{ins.source.lines.length ? ins.source.lines.join('\n') : ins.text}</div>
            </div>
            {ins.source.imageIds.map((id) => <button key={id} className="btn soft" onClick={() => go(`/p/${project.id}/chart/${id}`)}>Open {pattern.images.find((i) => i.id === id)?.title}</button>)}
            <button className="btn primary" onClick={() => go(`/p/${project.id}/pdf?page=${ins.source.page}`)} data-testid="open-source-page">OPEN PDF PAGE {ins.source.page}</button>
          </div>
        )}
        {view === 'note' && (
          <>
            <NoteComposer projectId={project.id} scope={{ type: 'instruction', instructionId: ins.id }} placeholder="e.g. Stopped halfway through row 31 after second marker." onSaved={() => { toast('Note saved'); setView('menu'); }} />
          </>
        )}
        {view === 'counter' && <CounterForm project={project} ins={ins} onDone={() => setView('menu')} />}
        {view === 'stitch' && <StitchForm project={project} pattern={pattern} ins={ins} sizeIndex={sizeIndex} onDone={() => setView('menu')} />}
        {view === 'mod' && <ModForm project={project} ins={ins} original={ins.text} onDone={() => setView('menu')} />}
      </Sheet>
      {abbrSheet}
    </>
  );
}

function ExplainView({ ins, pattern, project, sizeIndex }: { ins: Instruction; pattern: Pattern; project: Project; sizeIndex: number }) {
  const resolved = resolveText(ins.text, pattern.sizes, sizeIndex);
  const notes = findSizeGroups(ins.text, pattern.sizes.length).filter((g) => g.matchesSizes).map((g) => `${g.raw} → ${g.values[sizeIndex]} for size ${project.size}`);
  const ex = explain(resolved, pattern.abbreviations, notes);
  const { setTerm, sheet } = useAbbrSheet();
  return (
    <div className="stack" data-testid="explain-view">
      <div className="card">
        <span className="pat-label">Original pattern</span>
        <div className="pre">{ins.text}</div>
      </div>
      <div className="card flat">
        <span className="pat-label guide">Guidance · generated by Knit Guide, not written by the designer</span>
        {ex.notes.length > 0 && <ul style={{ margin: '4px 0', paddingLeft: 20 }}>{ex.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        {ex.steps.length > 0 ? (
          <ol style={{ margin: '6px 0', paddingLeft: 22 }} data-testid="explain-steps">{ex.steps.map((s, i) => <li key={i} style={{ marginBottom: 4 }}>{s}</li>)}</ol>
        ) : (
          <p className="muted" style={{ margin: '6px 0' }}>This instruction is written as prose, so there is no step list. Read the terms below, or the original.</p>
        )}
        {ex.untranslated.length > 0 && ex.steps.length > 0 && <p className="small-text muted">Some wording could not be translated automatically. The original above is the reference.</p>}
      </div>
      {ex.terms.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="caps">Terms</span>
          <div className="chips" style={{ marginTop: 0 }}>{ex.terms.map((t) => <button className="chip" key={t.key} onClick={() => setTerm(t)}>{t.display}</button>)}</div>
        </div>
      )}
      {sheet}
    </div>
  );
}

function CounterForm({ project, ins, onDone }: { project: Project; ins: Instruction; onDone: () => void }) {
  const [kind, setKind] = useState<CounterKind>('rows');
  const [label, setLabel] = useState('');
  const [target, setTarget] = useState('');
  const [auto, setAuto] = useState(false);
  const kinds: [CounterKind, string][] = [['rows', 'Rows'], ['rounds', 'Rounds'], ['times', 'Repeats'], ['stitches', 'Stitches'], ['custom', 'Custom']];
  return (
    <div className="stack">
      <div className="field"><label>Type</label><div className="chips" style={{ marginTop: 0 }}>{kinds.map(([k, n]) => <button key={k} className={`chip ${kind === k ? 'ok' : ''}`} onClick={() => setKind(k)} data-testid={`kind-${k}`}>{n}</button>)}</div></div>
      <div className="field"><label htmlFor="cl2">Label (optional)</label><input id="cl2" className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={kind === 'custom' ? 'e.g. Buttonholes' : ''} /></div>
      <div className="field"><label htmlFor="ct2">Target (optional)</label><input id="ct2" className="input" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value.replace(/\D/g, ''))} data-testid="counter-target" /></div>
      <label className="row" style={{ minHeight: 48 }}><input type="checkbox" style={{ width: 26, height: 26 }} checked={auto} onChange={(e) => setAuto(e.target.checked)} /><span>Auto-advance to the next instruction at the target</span></label>
      <button className="btn primary" data-testid="create-counter" onClick={() => { addCounter(project.id, ins.id, kind, label.trim() || kinds.find((k) => k[0] === kind)![1], target ? Number(target) : undefined, auto); onDone(); }}>CREATE COUNTER</button>
    </div>
  );
}

function StitchForm({ project, pattern, ins, sizeIndex, onDone }: { project: Project; pattern: Pattern; ins: Instruction; sizeIndex: number; onDone: () => void }) {
  const stitchSuggestion = suggestionsFor(ins, pattern).find((s) => s.kind === 'stitch');
  const pre = stitchSuggestion ? suggestionTarget(stitchSuggestion, sizeIndex) : undefined;
  const [target, setTarget] = useState(pre ? String(pre) : '');
  const [group, setGroup] = useState(10);
  const [custom, setCustom] = useState('');
  return (
    <div className="stack">
      <div className="field"><label htmlFor="stt">Target stitches</label><input id="stt" className="input" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value.replace(/\D/g, ''))} data-testid="stitch-target" /></div>
      <div className="field">
        <label>Group size</label>
        <div className="row wrap">
          {[5, 10, 20].map((n) => <button key={n} className={`chip ${group === n ? 'ok' : ''}`} onClick={() => setGroup(n)} data-testid={`group-${n}`}>{n}</button>)}
          <input className="input" style={{ width: 110 }} inputMode="numeric" placeholder="custom" value={custom} onChange={(e) => { setCustom(e.target.value.replace(/\D/g, '')); if (Number(e.target.value) >= 2) setGroup(Number(e.target.value)); }} aria-label="Custom group size" />
        </div>
      </div>
      <button className="btn primary" disabled={!target || Number(target) < 1} data-testid="create-stitch" onClick={() => { addStitchCounter(project.id, ins.id, Number(target), group, stitchSuggestion?.label ?? 'Stitches'); onDone(); }}>START STITCH COUNTER</button>
    </div>
  );
}

function ModForm({ project, ins, original, onDone }: { project: Project; ins: Instruction; original: string; onDone: () => void }) {
  const [text, setText] = useState('');
  return (
    <div className="stack">
      <div className="card"><span className="pat-label">Pattern</span><div className="pre">{original}</div></div>
      <div className="field"><label htmlFor="mm">My modification</label><textarea id="mm" className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Make this a long cardigan. Aim for mid-thigh." data-testid="mod-text" /></div>
      <button className="btn primary" disabled={!text.trim()} onClick={() => { addModification(project.id, ins.id, text.trim()); onDone(); }}>SAVE MODIFICATION</button>
      <p className="muted small-text">Stored beside the pattern. The designer's instruction stays exactly as written.</p>
    </div>
  );
}
