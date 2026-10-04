import { useState } from 'react';
import { describeRow, pick } from '../engine/tracker';
import { findInstruction } from '../model/helpers';
import type { Pattern, Project, TrackerSpec } from '../model/types';
import { finishAndAdvance, setTrackerFirst, setTrackerLaceOffset, setTrackerRow } from '../store/store';
import { Sheet } from '../ui/common';
import { RichText, useAbbrSheet } from './RichText';

export function TrackerCard({ project, pattern, spec, onViewOriginal }: { project: Project; pattern: Pattern; spec: TrackerSpec; onViewOriginal: (instructionId: string) => void }) {
  const [settings, setSettings] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const { setTerm, sheet: abbrSheet } = useAbbrSheet();
  const state = project.trackers[spec.id] ?? { row: spec.firstRow, firstOverrides: {} };
  const sizeIndex = pattern.sizes.indexOf(project.size);
  const rep = describeRow(spec, state.row, { sizeIndex, sizeCount: pattern.sizes.length, state, stitchPatterns: pattern.stitchPatterns });
  const unitName = spec.unit === 'round' ? 'ROUND' : 'ROW';
  const lastIns = spec.sourceInstructionIds[spec.sourceInstructionIds.length - 1];
  const trackerIns = pattern.instructions.find((i) => i.trackerId === spec.id);
  const laceLen = pattern.stitchPatterns.find((p) => p.id === spec.lace?.stitchPatternId)?.rows.length || 4;
  const needsReview = spec.review.length > 0 || rep.shaping.some((s) => s.status === 'review');

  return (
    <div className="tracker" data-testid="tracker">
      <div className="row">
        <span className="badge gen">Generated guide</span>
        {needsReview && <button className="badge review" onClick={() => setShowReview((v) => !v)} data-testid="needs-review">NEEDS REVIEW</button>}
        <span className="grow" />
        <button className="btn small ghost" onClick={() => setSettings(true)}>Adjust</button>
      </div>
      {showReview && (
        <div className="warnbox stack" style={{ gap: 6 }}>
          {spec.review.map((r, i) => <div key={i}>• {r}</div>)}
          <div>The designer's original wording is shown under each line below.</div>
        </div>
      )}
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div className="grow">
          <div className="caps">{spec.title.split(':')[0]}</div>
          <div className="rowno" data-testid="tracker-row">{unitName} {rep.row}{rep.end ? <small style={{ fontSize: 22, color: 'var(--muted)' }}> of {rep.end}</small> : null}</div>
        </div>
        {rep.side && <span className="badge" style={{ fontSize: 16 }} data-testid="tracker-side">{rep.side}</span>}
      </div>

      {rep.beyondEnd && (
        <div className="done-banner">END OF THIS SECTION REACHED (row {rep.end})</div>
      )}

      {rep.lace && (
        <div className="tline" data-testid="tracker-lace">
          <span className="lbl">Lace repeat</span>
          <span className="head">Pattern {spec.unit} {rep.lace.n} of {rep.lace.of}</span>
          <blockquote><span className="pat-label">Original pattern</span>{rep.lace.text}</blockquote>
        </div>
      )}
      {rep.plain && !rep.shaping.some((s) => s.status === 'do') && (
        <div className="tline">
          <span className="lbl">This {spec.unit}</span>
          <blockquote><span className="pat-label">Original pattern</span>{rep.plain.text}</blockquote>
        </div>
      )}
      {rep.shaping.map((s) => (
        <div className={`tline ${s.status}`} key={s.id} data-testid="tracker-line" data-status={s.status}>
          <span className="lbl">{s.label}</span>
          <span className="head">{s.status === 'review' ? <span className="badge review">NEEDS REVIEW</span> : s.headline}</span>
          {s.parts && (
            <div className="parts">{s.parts.map((p) => <span key={p.name} className={`part ${p.active ? '' : 'off'}`}>{p.name}</span>)}</div>
          )}
          {s.detail && <span className="muted small-text">{s.detail}</span>}
          {s.progress && s.progress.total ? <div className="progress" style={{ marginTop: 4 }}><i style={{ width: `${Math.min(100, (100 * (s.progress.done + (s.status === 'do' ? 1 : 0))) / s.progress.total)}%` }} /></div> : null}
          {(s.status === 'do' || s.status === 'review') && (s.excerpt || s.status === 'review') && (
            <blockquote>
              <span className="pat-label">Original pattern</span>
              <RichText text={s.excerpt ?? findInstruction(pattern, s.sourceInstructionId)?.text ?? ''} pattern={pattern} sizeIndex={sizeIndex} onTerm={setTerm} />
            </blockquote>
          )}
          <button className="btn ghost small" style={{ alignSelf: 'flex-start', minHeight: 32, padding: 0 }} onClick={() => onViewOriginal(s.sourceInstructionId)}>View original instruction</button>
        </div>
      ))}

      <div className="row">
        <button className="pad sm" style={{ flex: 1 }} onClick={() => setTrackerRow(project.id, spec.id, state.row - 1)} disabled={state.row <= 1} aria-label={`Previous ${spec.unit}`}>◀ BACK</button>
        <button className="pad plus" style={{ flex: 2.4, minHeight: 72, fontSize: 22 }} onClick={() => setTrackerRow(project.id, spec.id, state.row + 1)} data-testid="tracker-next">{unitName} DONE · NEXT ▶</button>
      </div>
      {rep.beyondEnd && trackerIns && (
        <button className="btn primary" onClick={() => finishAndAdvance(project.id, trackerIns.id)}>FINISH THIS SECTION · NEXT INSTRUCTION</button>
      )}
      {abbrSheet}
      {settings && (
        <Sheet title="Adjust guide" onClose={() => setSettings(false)}>
          <div className="field">
            <label htmlFor="jr">Jump to {spec.unit}</label>
            <input id="jr" className="input" inputMode="numeric" defaultValue={state.row} onBlur={(e) => { const n = Number(e.target.value); if (n >= 1) setTrackerRow(project.id, spec.id, n); }} />
          </div>
          {spec.intervals.map((iv) => {
            const first = state.firstOverrides[iv.id] ?? iv.first;
            return (
              <div className="card stack" key={iv.id}>
                <b>{iv.label}: first shaping {spec.unit}</b>
                <span className="muted small-text">{iv.firstAssumed ? 'Not stated by the designer, so this is an assumption. Check the chart.' : 'Stated by the designer.'}</span>
                <div className="row">
                  <button className="pad sm" style={{ flex: 1 }} onClick={() => setTrackerFirst(project.id, spec.id, iv.id, Math.max(1, first - 1))}>−</button>
                  <div className="formula" style={{ flex: 1 }} data-testid="first-row">{first}</div>
                  <button className="pad sm" style={{ flex: 1 }} onClick={() => setTrackerFirst(project.id, spec.id, iv.id, first + 1)}>+</button>
                </div>
                <span className="small-text">Every {iv.every}{iv.every === 1 ? '' : 'th'} {spec.unit}{iv.times ? `, ${pick(iv.times, sizeIndex, pattern.sizes.length) ?? '?'} times for size ${project.size}` : ''}.</span>
              </div>
            );
          })}
          {spec.lace && (
            <div className="card stack">
              <b>Lace alignment</b>
              <span className="muted small-text">Garment {spec.unit} {spec.firstRow} = lace {spec.unit} {(((state.laceOffset ?? spec.lace.offset) % laceLen) + laceLen) % laceLen + 1}. Shift if your chart starts elsewhere.</span>
              <div className="row">
                <button className="pad sm" style={{ flex: 1 }} onClick={() => setTrackerLaceOffset(project.id, spec.id, (state.laceOffset ?? spec.lace!.offset) - 1)}>−</button>
                <div className="formula" style={{ flex: 1 }}>{state.laceOffset ?? spec.lace.offset}</div>
                <button className="pad sm" style={{ flex: 1 }} onClick={() => setTrackerLaceOffset(project.id, spec.id, (state.laceOffset ?? spec.lace!.offset) + 1)}>+</button>
              </div>
            </div>
          )}
          <button className="btn soft" onClick={() => { setSettings(false); onViewOriginal(lastIns); }}>View designer's original instructions</button>
        </Sheet>
      )}
    </div>
  );
}
