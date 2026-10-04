import { createContext, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { InstructionSheet } from '../components/InstructionSheet';
import { NoteCard, NoteComposer } from '../components/Notes';
import { RichText, useAbbrSheet } from '../components/RichText';
import { StitchCounterCard } from '../components/Counters';
import { useResolver } from '../components/Resolver';
import { TrackerCard } from '../components/TrackerCard';
import { constructionText } from '../guidance/translate';
import { buildModel, currentPart, resolveCurrent, stepsKeyFor, yokeRow, bhKey, measuredKey, prefsOf } from '../guidance/flow';
import type { Guidance } from '../guidance/flow';
import { dueCm } from '../guidance/plan';
import { TECHNIQUES } from '../guidance/techniques';
import type { TStep } from '../guidance/translate';
import { projectFacts } from '../model/facts';
import { guideInstruction, guidePlain } from '../model/guide';
import { findInstruction, formatWhen, guideCtxOf } from '../model/helpers';
import type { Pattern, Project } from '../model/types';
import {
  addStitchCounter, attachStopNote, finishAndAdvance, knitFromHere, measuredEventDone, phaseBack, phaseDone, phaseSkip, quickStop, recordMeasurement, saveCheckpoint, saveGuidanceOverride,
  setMeasuredDue, setTrackerFirst, setTrackerRow, tickStep, useStore, yokeRowBack, yokeRowDone,
} from '../store/store';
import { IconPdf, IconStop, Sheet, ToastHost, TopBar, toast } from '../ui/common';
import { go } from '../ui/router';
import { progressFraction } from '../model/helpers';

/* ------------------------------------------------------------- pieces */

function TechHelp({ ids, onOpen }: { ids: string[]; onOpen: (id: string) => void }) {
  return (
    <>
      {ids.filter((i) => TECHNIQUES[i]).map((id) => (
        <button key={id} className="tech" aria-label={`Help: ${TECHNIQUES[id].name}`} data-testid="tech-help" onClick={() => onOpen(id)}>
          <b>?</b> {TECHNIQUES[id].abbr ?? TECHNIQUES[id].name}
        </button>
      ))}
    </>
  );
}

function StepList({ steps, keyId, project, onTech }: { steps: TStep[]; keyId: string; project: Project; onTech: (id: string) => void }) {
  const done = project.knit?.stepsDone?.[keyId] ?? [];
  const firstOpen = steps.findIndex((st, i) => !st.note && !done.includes(i));
  let n = 0;
  return (
    <ol className="ksteps" data-testid="knit-steps">
      {steps.map((s, i) => {
        if (s.note) {
          return <li key={i} className={`knote ${/:$/.test(s.text) ? 'head' : ''}`} data-testid="knit-note">{s.text}</li>;
        }
        n++;
        const on = done.includes(i);
        return (
          <li key={i} className={`kstep ${on ? 'done' : ''} ${i === firstOpen ? 'now' : ''} ${s.review ? 'rev' : ''}`} data-testid="knit-step">
            <button className="kcheck" aria-label={on ? `Step ${n} done, tap to undo` : `Mark step ${n} done`} aria-pressed={on} onClick={() => tickStep(project.id, keyId, i, !on)}>
              <i>{on ? '✓' : n}</i>
            </button>
            <div className="grow">
              <div className="kt">{s.text}</div>
              {s.tech.length > 0 && <div className="chips" style={{ marginTop: 4 }}><TechHelp ids={s.tech} onOpen={onTech} /></div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Why({ lines }: { lines: string[] }) {
  const [open, setOpen] = useState(false);
  if (!lines.length) return null;
  return (
    <div className={`whybox ${open ? 'open' : ''}`}>
      <button className="why-head" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="why-btn"><h3>Why?</h3><span aria-hidden="true">{open ? '–' : '+'}</span></button>
      {open && <div className="why" data-testid="why-text">{lines.map((l, i) => <p key={i} style={{ margin: '4px 0' }}>{l}</p>)}</div>}
    </div>
  );
}

function PatternSays({ text, pattern }: { text: string; pattern: Pattern }) {
  const { setTerm, sheet } = useAbbrSheet();
  return (
    <details className="says" data-testid="pattern-says">
      <summary><span className="pat-label" style={{ display: 'inline' }}>PATTERN SAYS</span></summary>
      <span className="small-text"><RichText text={text} pattern={pattern} onTerm={setTerm} /></span>
      {sheet}
    </details>
  );
}

/** Opens the stitch counter with the target filled in; a confirmed count is stored as verified. */
function CountSheet({ project, cpKey, expected, label, onClose }: { project: Project; cpKey: string; expected: number; label: string; onClose: () => void }) {
  const sc = project.stitchCounters.find((c) => c.instructionId === cpKey);
  const cp = project.knit?.checkpoints?.[cpKey];
  const total = sc?.total ?? 0;
  useEffect(() => {
    if (!sc) addStitchCounter(project.id, cpKey, expected, 10, label);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Sheet title="Count your stitches" onClose={onClose}>
      <div className="stack" data-testid="count-sheet">
        <div className="stat-row">
          <div><b data-testid="cp-target">{expected}</b><span>Target</span></div>
          <div><b data-testid="cp-current">{total}</b><span>Current</span></div>
          <div><b data-testid="cp-remaining">{Math.max(0, expected - total)}</b><span>Remaining</span></div>
        </div>
        {sc && <StitchCounterCard projectId={project.id} counter={sc} />}
        {sc && total === expected && (
          <button className="btn primary big block" data-testid="cp-confirm" onClick={() => { saveCheckpoint(project.id, cpKey, expected, total); toast('Stitch count verified'); onClose(); }}>
            ✓ CONFIRM {expected} STITCHES
          </button>
        )}
        {sc && total !== expected && total > 0 && (
          <div className="warnbox" data-testid="cp-mismatch">
            <b>Your count is {total}, the guide expects {expected}.</b> Nothing moves on by itself. Recount, or save this count and check the previous rows.
            <button className="btn small block" style={{ marginTop: 8 }} data-testid="cp-save-mismatch" onClick={() => { saveCheckpoint(project.id, cpKey, expected, total); onClose(); }}>SAVE MY COUNT ({total}) AS NOT MATCHING</button>
          </div>
        )}
        {cp?.verifiedAt && <div className="done-banner">✓ VERIFIED EARLIER: {cp.counted}</div>}
      </div>
    </Sheet>
  );
}

function Checkpoint({ project, cpKey, expected, label }: { project: Project; cpKey: string; expected: number; label: string }) {
  const [open, setOpen] = useState(false);
  const cp = project.knit?.checkpoints?.[cpKey];
  const verified = !!cp?.verifiedAt;
  return (
    <div className={`checkpoint ${verified ? 'ok' : ''}`} data-testid="checkpoint">
      <div className="kt">You should now have <b data-testid="cp-expected">{expected}</b> stitches{label ? ` (${label})` : ''}.</div>
      {verified ? (
        <div className="done-banner" data-testid="cp-verified">✓ COUNT VERIFIED: {cp?.counted} STITCHES</div>
      ) : cp?.counted !== undefined ? (
        <div className="warnbox" data-testid="cp-notmatch">You counted {cp.counted}, the guide expects {expected}. Check before you go on.</div>
      ) : null}
      <button className="btn block" data-testid="count-stitches" onClick={() => setOpen(true)}>{verified ? 'COUNT AGAIN' : 'COUNT STITCHES'}</button>
      {open && <CountSheet project={project} cpKey={cpKey} expected={expected} label={label || 'checkpoint'} onClose={() => setOpen(false)} />}
    </div>
  );
}

function MeasureCheck({ project, mkey, target, label, from }: { project: Project; mkey: string; target: number; label: string; from: string }) {
  const saved = project.knit?.measurements?.[mkey];
  const [v, setV] = useState(saved ? String(saved.cm) : '');
  const reached = saved && saved.cm >= target;
  return (
    <div className="measure" data-testid="measure-check">
      <span className="caps">MEASUREMENT CHECK</span>
      <div className="kt">Measure the {label} from {from}. The pattern wants <b>{target} cm</b>. The app cannot know your measurement, so you tell it.</div>
      <div className="row">
        <input className="input" inputMode="decimal" placeholder="my measurement, cm" aria-label="My measurement in cm" value={v} onChange={(e) => setV(e.target.value.replace(/[^\d.]/g, ''))} data-testid="measure-input" />
        <button className="btn" disabled={!v} data-testid="measure-save" onClick={() => recordMeasurement(project.id, mkey, Number(v))}>SAVE</button>
      </div>
      {saved && <div className={reached ? 'done-banner' : 'warnbox'} data-testid="measure-result">{reached ? `✓ ${saved.cm} cm: target reached` : `${saved.cm} cm so far: ${Math.max(0, +(target - saved.cm).toFixed(1))} cm to go. Keep knitting, then measure again.`}</div>}
    </div>
  );
}

function ReviewBox({ project, pattern, g, onNote }: { project: Project; pattern: Pattern; g: Guidance; onNote: () => void }) {
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState('');
  const [orig, setOrig] = useState(false);
  const bad = g.tr?.steps.filter((s) => s.review) ?? [];
  return (
    <div className="warnbox review-box stack" data-testid="guidance-review" style={{ gap: 8 }}>
      <b>⚠ GUIDANCE NEEDS REVIEW</b>
      <span>The guide could not safely turn this into steps. It did not guess. The original wording:</span>
      {bad.filter((s) => s.original).map((s, i) => <blockquote key={i} className="says" style={{ margin: 0 }}><span className="pat-label">PATTERN SAYS</span>{s.original}</blockquote>)}
      <div className="row wrap">
        <button className="btn small" data-testid="gr-add" onClick={() => setEdit(true)}>ADD MY INTERPRETATION</button>
        <button className="btn small" onClick={onNote} data-testid="gr-note">ADD NOTE</button>
        <button className="btn small" onClick={() => setOrig(true)}>VIEW ORIGINAL</button>
      </div>
      {edit && (
        <Sheet title="My interpretation" onClose={() => setEdit(false)}>
          <p className="muted small-text" style={{ margin: 0 }}>One step per line. Saved with this project only. The designer's pattern is not changed.</p>
          <textarea className="textarea" aria-label="My interpretation" data-testid="gr-text" value={text} onChange={(e) => setText(e.target.value)} placeholder={'Knit 10 stitches.\nTurn your work.'} />
          <button className="btn primary" disabled={!text.trim()} data-testid="gr-save" onClick={() => { saveGuidanceOverride(project.id, g.ins.id, text.split('\n').map((x) => x.trim()).filter(Boolean)); setEdit(false); }}>SAVE MY INTERPRETATION</button>
        </Sheet>
      )}
      {orig && <InstructionSheet project={project} pattern={pattern} ins={g.ins} initialView="original" onClose={() => setOrig(false)} />}
    </div>
  );
}

/* --------------------------------------------------------------- cards */

/** The big primary button lives in the fixed dock beside Quick Stop, so it is always one thumb away. */
const SlotCtx = createContext<HTMLElement | null>(null);
function Primary({ children }: { children: React.ReactNode }) {
  const slot = useContext(SlotCtx);
  return slot ? createPortal(children, slot) : null;
}

const ICONS: Record<string, string> = {
  size: '<path d="M4 17L17 4l3 3L7 20z"/><path d="M8 13l2 2M11 10l2 2M14 7l2 2"/>',
  flat: '<path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/>',
  round: '<path d="M20 12a8 8 0 11-3-6.2"/><path d="M20 4v5h-5"/>',
  needle: '<path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.6"/>',
  side: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
  sts: '<path d="M6 8c3-3 9-3 12 0M6 12c3-3 9-3 12 0M6 16c3-3 9-3 12 0"/>',
};
interface Ctx { icon: keyof typeof ICONS; label: string; value: string; testId?: string }
function ContextPanel({ items }: { items: (Ctx | undefined | false | '')[] }) {
  return (
    <div className="kctx" data-testid="knit-context">
      {items.filter((x): x is Ctx => !!x).map((c) => (
        <div className="kcell" key={c.label}>
          <svg className="kico" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[c.icon] }} />
          <div><span className="kl">{c.label}</span> <b className="kv" data-testid={c.testId}>{c.value}</b></div>
        </div>
      ))}
    </div>
  );
}
const workingLabel = (c?: string) => (c === 'round' ? 'In the round' : 'Flat (back and forth)');
const sideWord = (x: 'RS' | 'WS') => (x === 'RS' ? 'Right side' : 'Wrong side');

/** 1. WHERE I AM: pattern, section, row, progress. */
function Where({ pattern, project, title, row }: { pattern: Pattern; project: Project; title: string; row?: number; side?: 'RS' | 'WS' }) {
  const frac = progressFraction(pattern, project);
  return (
    <header className="kwhere" data-testid="knit-where">
      <div className="kpat">{pattern.title}</div>
      <h2 className="ksec">{title.replace(/[:.]$/, '')}</h2>
      {row !== undefined && (
        <div className="krowline">
          <span className="krow" data-testid="knit-rowno">ROW {row}</span>
                  </div>
      )}
      <div className="kprog" aria-label={`Pattern progress ${Math.round(frac * 100)}%`}>
        <div className="progress"><i style={{ width: `${Math.max(2, frac * 100)}%` }} /></div>
        <span className="tiny">{Math.round(frac * 100)}% of the pattern</span>
      </div>
    </header>
  );
}

function YokeCard({ g, project, pattern, onTech }: { g: Guidance; project: Project; pattern: Pattern; onTech: (id: string) => void }) {
  const r = yokeRow(g, project)!;
  const plan = g.plan!;
  const spec = g.spec!;
  const gctx = guideCtxOf(pattern, project);
  const key = stepsKeyFor(g, project);
  const [adjust, setAdjust] = useState(false);
  const ts = project.trackers[spec.id];
  const bh = project.knit?.measured?.[bhKey(spec.id)] ?? { done: 0, due: false };
  const sayTexts = plan.sourceIds.map((id) => findInstruction(pattern, id)).filter(Boolean).map((i) => guidePlain(i!, gctx)).join('\n\n');
  const cp = r.checkpoint;
  return (
    <>
      <Where pattern={pattern} project={project} title={g.title} row={r.row} side={r.side} />
      <ContextPanel items={[{ icon: 'size', label: 'Size', value: project.size }, { icon: 'flat', label: 'Working', value: workingLabel('flat') }, !!project.setup.needle && { icon: 'needle', label: 'Needle', value: project.setup.needle }, { icon: 'side', label: 'Side', value: sideWord(r.side), testId: 'knit-side' }, { icon: 'sts', label: 'Stitches now', value: String(r.before) }]} />
      <div className="kcard" key={r.row} data-testid="knit-card" data-kind="yoke">
        {r.jobs.length > 0 ? (
          <div className="jobs" data-testid="knit-jobs">
            <b className="jobs-h">This row has {r.jobs.length} job{r.jobs.length === 1 ? '' : 's'}:</b>
            <ul>{r.jobs.map((j) => <li key={j}>{j}</li>)}</ul>
          </div>
        ) : (
          <div className="jobs plain" data-testid="knit-jobs">{r.side === 'RS' ? 'No increases on this row. Just knit it as set out below.' : 'No increases on this row.'}</div>
        )}
        {r.bhPrompt && (
          <div className="measure" data-testid="bh-prompt">
            <b>Buttonhole {r.bhPrompt.n} of {r.bhPrompt.total}</b>
            <div className="small-text">{r.bhPrompt.text}</div>
            <button className="btn small" data-testid="bh-reached" onClick={() => setMeasuredDue(project.id, bhKey(spec.id), !bh.due)}>
              {bh.due ? '✓ MARKED DUE (tap to undo)' : `I'VE REACHED BUTTONHOLE ${r.bhPrompt.n}`}
            </button>
            {bh.due && r.side === 'WS' && <div className="small-text">It will be added on your next right-side row.</div>}
          </div>
        )}
        {r.buttonhole && <div className="done-banner" data-testid="bh-due">BUTTONHOLE DUE · BUTTONHOLE {r.buttonhole.n} OF {r.buttonhole.total}</div>}
        <section className="dothis"><h3>Do this</h3>
        <StepList steps={r.steps} keyId={key} project={project} onTech={onTech} /></section>
        {cp ? <Checkpoint project={project} cpKey={`${spec.id}:r${r.row}:cp`} expected={cp.expected} label={cp.label} /> : <div className="small-text muted" data-testid="expect-line">After this row you should have {r.after} stitches.</div>}
        {r.increasesFinished && plan.endCm !== undefined && (
          <>
            <MeasureCheck project={project} mkey={`${spec.id}:yoke`} target={plan.endCm} label="yoke" from="the cast-on edge, at the middle of the back" />
            <button className="btn block" data-testid="yoke-long-enough" onClick={() => { const n = finishAndAdvance(project.id, g.ins.id); if (!n) toast('Pattern finished'); }}>YOKE IS LONG ENOUGH · NEXT SECTION</button>
          </>
        )}
        <Why lines={r.why} />
        <div className="track" data-testid="knit-tracking">
          <div className="tiles">
            {r.tracking.map((t) => <div key={t.label} className={`tile2 ${t.now ? 'now' : ''}`} data-testid="track-line"><span className="tl">{t.label}</span> <b>{t.done} of {t.total}</b>{t.now ? <small> this row</small> : null}</div>)}
            <div className="tile2"><span className="tl">Stitches</span> <b>{r.added ? `+ ${r.added}` : 'no change'}</b></div>
            <div className="tile2"><span className="tl">Next row</span> <b>{sideWord(r.side === 'RS' ? 'WS' : 'RS')}</b></div>
          </div>
          <div className="small-text" data-testid="stitch-math">Stitches: {r.before}{r.added ? ` + ${r.added} added` : ' (no increases)'} = <b data-testid="expected-stitches">{r.after}</b> expected after this row</div>
        </div>
        {plan.review.length > 0 && <div className="warnbox review-box" data-testid="yoke-review"><b>⚠ GUIDANCE NEEDS REVIEW</b>{plan.review.map((x, i) => <div key={i}>{x}</div>)}</div>}
        <PatternSays text={sayTexts} pattern={pattern} />
        <details className="assume"><summary>Assumptions this guide makes</summary>{plan.assumptions.map((a) => <p key={a} className="small-text" style={{ margin: '4px 0' }}>{a}</p>)}</details>
        <div className="row wrap">
          <button className="btn small" disabled={r.row <= 1} aria-label="Previous row" data-testid="row-back" onClick={() => yokeRowBack(project.id, g.ins.id)}>← Back one row</button>
          <button className="btn small ghost" onClick={() => setAdjust(true)}>Adjust row / V-neck start</button>
        </div>
      </div>
      <Primary>
        <button className="btn primary kprimary" data-testid="row-done" onClick={() => yokeRowDone(project.id, g.ins.id)}><span>ROW DONE <span aria-hidden="true">→</span></span></button>
      </Primary>
      {adjust && (
        <Sheet title="Adjust" onClose={() => setAdjust(false)}>
          <div className="field"><label htmlFor="kj">Jump to row</label><input id="kj" className="input" inputMode="numeric" defaultValue={r.row} onBlur={(e) => { const n = Number(e.target.value); if (n >= 1) setTrackerRow(project.id, spec.id, n); }} /></div>
          <div className="card stack">
            <b>First V-neck increase row</b>
            <span className="muted small-text">The pattern does not say which row. Assumed row 1. Change it here if yours differs.</span>
            <div className="row">
              <button className="pad sm" style={{ flex: 1 }} onClick={() => setTrackerFirst(project.id, spec.id, 'vneck', Math.max(1, (ts?.firstOverrides?.vneck ?? 1) - 1))}>−</button>
              <div className="formula" style={{ flex: 1 }}>{ts?.firstOverrides?.vneck ?? 1}</div>
              <button className="pad sm" style={{ flex: 1 }} onClick={() => setTrackerFirst(project.id, spec.id, 'vneck', (ts?.firstOverrides?.vneck ?? 1) + 1)}>+</button>
            </div>
          </div>
        </Sheet>
      )}
    </>
  );
}

function StepsCard({ g, project, pattern, onTech, onNote }: { g: Guidance; project: Project; pattern: Pattern; onTech: (id: string) => void; onNote: () => void }) {
  const resolver = useResolver(project, pattern);
  const gctx = guideCtxOf(pattern, project);
  const prefs = prefsOf(project);
  const tr = g.tr!;
  const key = stepsKeyFor(g, project);
  const override: TStep[] | undefined = g.override?.map((t) => ({ text: t, tech: [] as string[] }));
  const cp = currentPart(g, project);
  const rep = cp?.part.kind === 'repeat' ? cp.part.block : undefined;
  const steps = override ?? (cp ? (cp.part.kind === 'repeat' ? cp.part.block.rounds[cp.pos.idx]?.steps ?? [] : cp.part.steps) : tr.steps);
  const c = constructionText(g.construction, prefs);
  const sizeReview = guideInstruction(g.ins, gctx).review[0];
  const done = project.knit?.stepsDone?.[key] ?? [];
  const next = () => {
    if (cp) return phaseDone(project.id, g.ins.id);
    const n = finishAndAdvance(project.id, g.ins.id);
    if (!n) toast('Pattern finished');
  };
  const actionable = steps.filter((x) => !x.note).length;
  const ticked = done.filter((i) => steps[i] && !steps[i].note).length;
  // stitches after this round, only when every round's change is known
  const per = rep && rep.rounds.every((r) => r.delta !== undefined) ? rep.rounds.reduce((x, r) => x + (r.delta ?? 0), 0) : undefined;
  const after = rep && cp && per !== undefined && rep.before !== undefined ? rep.before + cp.pos.rep * per + rep.rounds.slice(0, cp.pos.idx + 1).reduce((x, r) => x + (r.delta ?? 0), 0) : undefined;
  const lastRound = !!rep && !!cp && rep.times !== undefined && cp.pos.rep === rep.times - 1 && cp.pos.idx === rep.rounds.length - 1;
  const unitWord = rep?.unit === 'row' ? 'ROW' : 'ROUND';
  return (
    <>
      <Where pattern={pattern} project={project} title={g.title} />
      <ContextPanel items={[{ icon: 'size', label: 'Size', value: project.size }, !!c && { icon: g.construction === 'round' ? 'round' : 'flat', label: 'Working', value: workingLabel(g.construction) }, !!project.setup.needle && { icon: 'needle', label: 'Needle', value: project.setup.needle }, g.stitchesBefore !== undefined && { icon: 'sts', label: 'Stitches now', value: String(g.stitchesBefore) }]} />
      <div className="kcard" key={g.ins.id} data-testid="knit-card" data-kind="steps">
        {c && <div className="small-text muted" data-testid="construction-detail"><b>{c.title}.</b> {c.detail}</div>}
        {tr.needs.length > 0 && (
          <div className="need" data-testid="you-need"><span className="caps">YOU NEED</span><ul>{tr.needs.map((n, i) => <li key={i}>{n}</li>)}</ul></div>
        )}
        {override && <div className="badge gen">My interpretation</div>}
        {rep && cp && (
          <div className="track" data-testid="repeat-tracking">
            <div className="tiles">
              <div className="tile2" data-testid="track-line"><span className="tl">Repeat</span> <b data-testid="rep-count">{rep.times !== undefined ? `${cp.pos.rep + 1} of ${rep.times}` : cp.pos.rep + 1}</b></div>
              <div className="tile2" data-testid="track-line"><span className="tl">{rep.unit === 'row' ? 'Row' : 'Round'}</span> <b data-testid="rep-round">{cp.pos.idx + 1} of {rep.rounds.length}</b></div>
              {after !== undefined && <div className="tile2"><span className="tl">Stitches after this {rep.unit}</span> <b data-testid="rep-stitches">{after}</b></div>}
              {per !== undefined && <div className="tile2"><span className="tl">Each repeat</span> <b>{per === 0 ? 'no change' : `${per > 0 ? '+' : ''}${per}`}</b></div>}
            </div>
          </div>
        )}
        <section className="dothis"><h3>{rep && cp ? rep.rounds[cp.pos.idx]?.label ?? 'Do this' : 'Do this'}</h3>
        <StepList steps={steps} keyId={key} project={project} onTech={onTech} /></section>
        {sizeReview && (
          <button className="btn small" data-testid="size-review-btn" onClick={() => resolver.open(g.ins, sizeReview)}>⚠ SIZE VALUE NEEDS REVIEW · CHOOSE MY VALUE</button>
        )}
        {g.review && !sizeReview && <ReviewBox project={project} pattern={pattern} g={g} onNote={onNote} />}
        {tr.measurement && <MeasureCheck project={project} mkey={tr.measurement.key} target={tr.measurement.target} label={tr.measurement.label} from={tr.measurement.from} />}
        {!cp && tr.checkpoint && <Checkpoint project={project} cpKey={`${g.ins.id}:cp`} expected={tr.checkpoint.expected} label={tr.checkpoint.label} />}
        {lastRound && rep && (rep.statedAfter ?? after) !== undefined && <Checkpoint project={project} cpKey={`${g.ins.id}:p${cp!.pos.part}:cp`} expected={(rep.statedAfter ?? after)!} label={`after the last ${rep.unit} of the repeats`} />}
        <Why lines={tr.why} />
        {rep?.until && (
          <>
            <MeasureCheck project={project} mkey={`${g.ins.id}:p${cp!.pos.part}:until`} target={rep.until.cm} label={rep.until.what} from={rep.until.from ?? 'the cast-on edge (lay it flat, do not stretch it)'} />
            <button className="btn block" data-testid="repeat-length-reached" onClick={() => phaseSkip(project.id, g.ins.id)}>LENGTH REACHED · NEXT</button>
          </>
        )}
        {cp && <div className="row wrap"><button className="btn small" data-testid="phase-back" onClick={() => phaseBack(project.id, g.ins.id)}>← Back one step</button></div>}
        <PatternSays text={guidePlain(g.ins, gctx)} pattern={pattern} />
        {tr.assumptions.length > 0 && <details className="assume"><summary>Assumptions</summary>{tr.assumptions.map((a) => <p key={a} className="small-text" style={{ margin: '4px 0' }}>{a}</p>)}</details>}
      </div>
      <Primary>
        <button className="btn primary kprimary" data-testid="step-done" onClick={next}>
          <span>{rep ? `${unitWord} DONE` : g.construction === 'round' ? 'ROUND DONE' : 'DONE'} <span aria-hidden="true">→</span></span>
          {ticked < actionable && <small>{actionable - ticked} step{actionable - ticked === 1 ? '' : 's'} not ticked</small>}
        </button>
      </Primary>
      {resolver.sheet}
    </>
  );
}

function MeasuredCard({ g, project, pattern, onTech }: { g: Guidance; project: Project; pattern: Pattern; onTech: (id: string) => void }) {
  const mp = g.measured!;
  const mk = measuredKey(g.ins.id);
  const ms = project.knit?.measured?.[mk] ?? { done: 0, due: false };
  const finished = ms.done >= mp.times;
  const target = dueCm(mp, Math.min(ms.done, mp.times - 1));
  const key = stepsKeyFor(g, project);
  const gctx = guideCtxOf(pattern, project);
  const after = mp.end ?? (g.stitchesBefore !== undefined ? g.stitchesBefore - mp.delta * mp.times : undefined);
  return (
    <>
      <Where pattern={pattern} project={project} title={g.title} />
      <ContextPanel items={[{ icon: 'size', label: 'Size', value: project.size }, { icon: 'round', label: 'Working', value: workingLabel('round') }, !!project.setup.needle && { icon: 'needle', label: 'Needle', value: project.setup.needle }, g.stitchesBefore !== undefined && { icon: 'sts', label: 'Stitches now', value: String(g.stitchesBefore - ms.done * mp.delta) }]} />
      <div className="kcard" key={`${g.ins.id}${ms.done}${ms.due}`} data-testid="knit-card" data-kind="measured">
        <div className="track" data-testid="knit-tracking">
          <div className="tiles">
            <div className="tile2" data-testid="track-line"><span className="tl">Decrease rounds done</span> <b>{ms.done} of {mp.times}</b></div>
            <div className="tile2"><span className="tl">Each round removes</span> <b>{mp.delta} stitches</b></div>
          </div>
        </div>
        {finished ? (
          <>
            <div className="done-banner" data-testid="measured-finished">✓ ALL {mp.times} DECREASE ROUNDS DONE</div>
            {after !== undefined && <Checkpoint project={project} cpKey={`${g.ins.id}:cp`} expected={after} label="after the last decrease" />}
          </>
        ) : ms.due ? (
          <>
            <div className="done-banner" data-testid="measured-due">DECREASE ROUND {ms.done + 1} OF {mp.times} IS DUE</div>
            <section className="dothis"><h3>Do this</h3>
            <StepList steps={g.eventSteps ?? []} keyId={key} project={project} onTech={onTech} /></section>
            <button className="btn small ghost" onClick={() => setMeasuredDue(project.id, mk, false)}>I tapped by mistake: not due yet</button>
          </>
        ) : (
          <>
            <div className="kt" data-testid="measured-wait">Knit every round as before. <b>No decreases yet.</b> Decrease round {ms.done + 1} is due when your sleeve measures <b>{target} cm</b>{ms.done === 0 ? ' from the underarm' : ' (measure from the underarm again)'}.</div>
            <MeasureCheck project={project} mkey={`${g.ins.id}:m${ms.done}`} target={target} label="sleeve" from="the underarm, where you picked up" />
            <button className="btn primary block" data-testid="measured-reached" onClick={() => setMeasuredDue(project.id, mk, true)}>I'VE REACHED {target} CM · DECREASE NOW</button>
          </>
        )}
        <PatternSays text={guidePlain(g.ins, gctx)} pattern={pattern} />
      </div>
      {finished ? (
        <Primary><button className="btn primary kprimary" data-testid="step-done" onClick={() => { const n = finishAndAdvance(project.id, g.ins.id); if (!n) toast('Pattern finished'); }}><span>DONE <span aria-hidden="true">→</span></span></button></Primary>
      ) : ms.due ? (
        <Primary><button className="btn primary kprimary" data-testid="round-done" onClick={() => measuredEventDone(project.id, g.ins.id)}><span>ROUND DONE <span aria-hidden="true">→</span></span></button></Primary>
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------------- main */

export function Knit({ projectId }: { projectId: string }) {
  const project = useStore((s) => s.projects[projectId]);
  const pattern = useStore((s) => (project ? s.patterns[project.patternId] : undefined));
  const [tech, setTech] = useState<string>();
  const [orig, setOrig] = useState(false);
  const [explain, setExplain] = useState(false);
  const [notes, setNotes] = useState(false);
  const [stop, setStop] = useState(false);
  const [stopNote, setStopNote] = useState('');
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const modelNow = project && pattern ? buildModel(pattern, project) : undefined;
  const curNow = modelNow && project ? resolveCurrent(modelNow, project.progress.currentInstructionId ?? pattern?.instructions[0]?.id) : undefined;
  const curId = curNow?.ins.id;
  const savedId = project?.progress.currentInstructionId;
  // keep the saved place equal to the card on screen (covered sentences resolve to the next real card)
  useEffect(() => {
    if (project && curId && savedId !== curId) knitFromHere(project.id, curId);
  }, [curId, savedId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!project || !pattern) return <div className="screen"><TopBar title="Knit" onBack={() => go('/')} /><div className="empty">Project not found.</div></div>;

  const model = buildModel(pattern, project);
  const g = resolveCurrent(model, project.progress.currentInstructionId ?? pattern.instructions[0]?.id);
  const facts = projectFacts(pattern, project.size);
  const ins = g?.ins;
  const noteCount = project.notes.length;
  const T = tech ? TECHNIQUES[tech] : undefined;

  return (
    <SlotCtx.Provider value={slot}>
    <div className="screen knit">
      <TopBar
        title="Knit"
        onBack={() => go(`/p/${project.id}`)}
        right={
          <>
            <button className="iconbtn" aria-label="Full pattern" data-testid="to-outline" onClick={() => go(`/p/${project.id}/outline?focus=1`)}>FULL</button>
            <button className="iconbtn" aria-label="View original" data-testid="knit-original" onClick={() => go(`/p/${project.id}/pdf`)}><IconPdf /></button>
          </>
        }
      />
      <div className="page-pad stack kpage" data-testid="knit-screen">
        {facts.flags.length > 0 && (
          <button className="warnbox review-box" style={{ textAlign: 'left', font: 'inherit' }} data-testid="measurement-review-banner" onClick={() => go(`/p/${project.id}/outline`)}>
            <b>⚠ MEASUREMENT NEEDS REVIEW</b> Two measurements disagree. Tap to choose in Project Data.
          </button>
        )}
        {!g ? (
          <div className="empty" data-testid="knit-empty">Nothing to knit here. Open the full pattern to pick a place.</div>
        ) : g.kind === 'yoke' && yokeRow(g, project) ? (
          <YokeCard g={g} project={project} pattern={pattern} onTech={setTech} />
        ) : g.kind === 'measured' ? (
          <MeasuredCard g={g} project={project} pattern={pattern} onTech={setTech} />
        ) : g.kind === 'legacy' && g.spec ? (
          <>
            <Where pattern={pattern} project={project} title={g.title} />
            <ContextPanel items={[{ icon: 'size', label: 'Size', value: project.size }, !!constructionText(g.construction, prefsOf(project)) && { icon: g.construction === 'round' ? 'round' : 'flat', label: 'Working', value: workingLabel(g.construction) }, !!project.setup.needle && { icon: 'needle', label: 'Needle', value: project.setup.needle }]} />
            <TrackerCard project={project} pattern={pattern} spec={g.spec} onViewOriginal={() => setOrig(true)} />
          </>
        ) : g.tr ? (
          <StepsCard g={g} project={project} pattern={pattern} onTech={setTech} onNote={() => setNotes(true)} />
        ) : null}

        {ins && (
          <div className="row wrap">
            <button className="btn small" data-testid="knit-view-original" onClick={() => setOrig(true)}>VIEW ORIGINAL</button>
            <button className="btn small" data-testid="knit-notes" onClick={() => setNotes(true)}>NOTES{noteCount ? ` (${noteCount})` : ''}</button>
            <button className="btn small ghost" data-testid="knit-explain" onClick={() => setExplain(true)}>Explain this</button>
          </div>
        )}
      </div>

      <div className="dock kdock">
        <button className="btn stop" data-testid="quick-stop" onClick={() => { quickStop(project.id); setStopNote(''); setStop(true); }}>
          <IconStop /> QUICK STOP
        </button>
        <div className="kslot" ref={setSlot} />
      </div>

      {T && (
        <Sheet title={T.name} onClose={() => setTech(undefined)}>
          <div className="stack" data-testid="tech-sheet">
            <ol className="how">{T.how.map((h, i) => <li key={i}>{h}</li>)}</ol>
            {T.why && <p className="muted small-text" style={{ margin: 0 }}>{T.why}</p>}
          </div>
        </Sheet>
      )}
      {orig && ins && <InstructionSheet project={project} pattern={pattern} ins={ins} initialView="original" onClose={() => setOrig(false)} />}
      {explain && ins && <InstructionSheet project={project} pattern={pattern} ins={ins} initialView="explain" onClose={() => setExplain(false)} />}
      {notes && (
        <Sheet title="Notes" onClose={() => setNotes(false)}>
          <div className="stack">
            {[...project.notes].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6).map((n) => <NoteCard key={n.id} project={project} pattern={pattern} note={n} />)}
            <NoteComposer projectId={project.id} scope={ins ? { type: 'instruction', instructionId: ins.id } : { type: 'project' }} onSaved={() => toast('Note saved')} />
          </div>
        </Sheet>
      )}
      {stop && (
        <Sheet title="Stopping point saved" onClose={() => setStop(false)}>
          <div className="done-banner" data-testid="stop-saved">✓ SAVED {formatWhen(project.progress.lastStop?.at)}</div>
          {project.progress.lastStop?.state && <StoppedCard project={project} />}
          <div className="field"><label htmlFor="sn">Quick note (optional)</label><textarea id="sn" className="textarea" value={stopNote} onChange={(e) => setStopNote(e.target.value)} placeholder="e.g. Stopped after second marker." data-testid="stop-note" /></div>
          <button className="btn primary" data-testid="stop-done" onClick={() => { if (stopNote.trim()) attachStopNote(project.id, stopNote); setStop(false); toast('Stopped. See you next time.'); }}>{stopNote.trim() ? 'SAVE NOTE & DONE' : 'DONE'}</button>
        </Sheet>
      )}
      <ToastHost />
    </div>
    </SlotCtx.Provider>
  );
}

/** "YOU STOPPED HERE" card: the frozen state at the last Quick Stop. */
export function StoppedCard({ project }: { project: Project }) {
  const st = project.progress.lastStop?.state;
  if (!st) return null;
  return (
    <div className="stopped" data-testid="stopped-here">
      <span className="caps">YOU STOPPED HERE</span>
      <div className="kt" data-testid="stopped-headline">{st.headline.join(' · ')}</div>
      {st.stitches !== undefined && <div>Stitches on the needle: <b>{st.stitches}</b></div>}
      {st.nextAction && <div>Next: {st.nextAction}</div>}
      {st.tracking.map((t) => <div key={t} className="small-text">{t}</div>)}
    </div>
  );
}
