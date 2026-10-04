import { useState } from 'react';
import { stitchView } from '../engine/stitch';
import type { Counter, StitchCounter } from '../model/types';
import {
  bumpCounter, bumpStitches, deleteCounter, deleteStitchCounter, patchStitchCounter, resetStitches, setCounter,
} from '../store/store';
import { ConfirmButton, Sheet } from '../ui/common';

const KIND_LABEL = { rows: 'Rows', rounds: 'Rounds', times: 'Repeats', stitches: 'Stitches', custom: 'Custom' } as const;

export function CounterCard({ projectId, counter }: { projectId: string; counter: Counter }) {
  const [edit, setEdit] = useState(false);
  const complete = !!counter.target && counter.value >= counter.target;
  return (
    <div className={`counter ${complete ? 'complete' : ''}`} data-testid="counter" data-kind={counter.kind}>
      <div className="top">
        <span className="name">{KIND_LABEL[counter.kind]}{counter.label && counter.label !== KIND_LABEL[counter.kind] ? ` · ${counter.label}` : ''}</span>
        <button className="btn small ghost" onClick={() => setEdit(true)} aria-label="Counter settings">Edit</button>
      </div>
      <div className="val" data-testid="counter-value" aria-live="polite">
        {counter.value}
        {counter.target ? <small> / {counter.target}</small> : null}
      </div>
      {complete && <div className="done-banner">✓ COMPLETE{counter.autoAdvance ? ' · moved on' : ''}</div>}
      <div className="pads">
        <button className="pad" aria-label="Minus one" onClick={() => bumpCounter(projectId, counter.id, -1)} disabled={counter.value === 0}>−1</button>
        <button className="pad plus" aria-label="Plus one" onClick={() => bumpCounter(projectId, counter.id, 1)}>+1</button>
      </div>
      <div className="row"><ConfirmButton className="btn small ghost" label="Reset" confirmLabel="Tap again to reset to 0" onConfirm={() => setCounter(projectId, counter.id, { value: 0 })} /></div>
      {edit && <CounterEdit projectId={projectId} counter={counter} onClose={() => setEdit(false)} />}
    </div>
  );
}

function CounterEdit({ projectId, counter, onClose }: { projectId: string; counter: Counter; onClose: () => void }) {
  const [target, setTarget] = useState(counter.target?.toString() ?? '');
  const [label, setLabel] = useState(counter.label);
  const [value, setValue] = useState(counter.value.toString());
  return (
    <Sheet title="Counter" onClose={onClose}>
      <div className="field"><label htmlFor="cl">Label</label><input id="cl" className="input" value={label} onChange={(e) => setLabel(e.target.value)} /></div>
      <div className="field"><label htmlFor="cv">Current value</label><input id="cv" className="input" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))} /></div>
      <div className="field"><label htmlFor="ct">Target (optional)</label><input id="ct" className="input" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value.replace(/\D/g, ''))} /></div>
      <label className="row" style={{ minHeight: 48 }}>
        <input type="checkbox" style={{ width: 26, height: 26 }} checked={counter.autoAdvance} onChange={(e) => setCounter(projectId, counter.id, { autoAdvance: e.target.checked })} />
        <span>Auto-advance to the next instruction when the target is reached</span>
      </label>
      <button className="btn primary" onClick={() => { setCounter(projectId, counter.id, { label: label.trim() || counter.label, target: target ? Number(target) : undefined, value: Number(value || 0) }); onClose(); }}>SAVE</button>
      <div className="row">
        <ConfirmButton label="Reset to 0" onConfirm={() => { setCounter(projectId, counter.id, { value: 0 }); onClose(); }} />
        <span className="grow" />
        <ConfirmButton label="Delete counter" onConfirm={() => { deleteCounter(projectId, counter.id); onClose(); }} />
      </div>
    </Sheet>
  );
}

export function StitchCounterCard({ projectId, counter }: { projectId: string; counter: StitchCounter }) {
  const [edit, setEdit] = useState(false);
  const v = stitchView(counter.total, counter.target, counter.groupSize);
  const g = counter.groupSize;
  return (
    <div className={`counter ${v.complete ? 'complete' : ''}`} data-testid="stitch-counter">
      <div className="top">
        <span className="name">Stitch counter · {counter.label}</span>
        <button className="btn small ghost" onClick={() => setEdit(true)}>Edit</button>
      </div>
      <div className="formula" data-testid="stitch-formula">{v.formula}</div>
      <div className="val" data-testid="stitch-progress" aria-live="polite">{v.total}<small> / {counter.target}</small></div>
      {v.complete && <div className="done-banner" data-testid="stitch-complete">✓ {v.total}/{counter.target} COMPLETE{v.over ? ` (${v.over} over)` : ''}</div>}
      <div className="stat-row">
        <div><b>{v.groups}</b><span>Groups of {g}</span></div>
        <div><b>{v.remainder}</b><span>Loose</span></div>
        <div><b>{v.remaining}</b><span>Remaining</span></div>
      </div>
      <div className="stitch-grid">
        <button className="pad group" style={{ minHeight: 96 }} onClick={() => bumpStitches(projectId, counter.id, g)} data-testid="plus-group">+ GROUP<br /><small style={{ fontSize: 15 }}>+{g}</small></button>
        <button className="pad one" style={{ minHeight: 96 }} onClick={() => bumpStitches(projectId, counter.id, 1)} data-testid="plus-one">+1 STITCH</button>
        <button className="pad sm" onClick={() => bumpStitches(projectId, counter.id, -g)} data-testid="minus-group" disabled={counter.total === 0}>− GROUP</button>
        <button className="pad sm" onClick={() => bumpStitches(projectId, counter.id, -1)} data-testid="minus-one" disabled={counter.total === 0}>−1 STITCH</button>
      </div>
      <div className="row"><ConfirmButton className="btn small ghost" label="RESET" confirmLabel="Tap again to reset to 0" onConfirm={() => resetStitches(projectId, counter.id)} /></div>
      {edit && <StitchEdit projectId={projectId} counter={counter} onClose={() => setEdit(false)} />}
    </div>
  );
}

function StitchEdit({ projectId, counter, onClose }: { projectId: string; counter: StitchCounter; onClose: () => void }) {
  const [target, setTarget] = useState(String(counter.target));
  const [custom, setCustom] = useState('');
  return (
    <Sheet title="Stitch counter" onClose={onClose}>
      <div className="field"><label htmlFor="st">Target stitches</label><input id="st" className="input" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value.replace(/\D/g, ''))} /></div>
      <div className="field">
        <label>Group size</label>
        <div className="row wrap">
          {[5, 10, 20].map((n) => (
            <button key={n} className={`chip ${counter.groupSize === n ? 'ok' : ''}`} onClick={() => patchStitchCounter(projectId, counter.id, { groupSize: n })}>{n}</button>
          ))}
          <input className="input" style={{ width: 110 }} inputMode="numeric" placeholder="custom" value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, ''))} aria-label="Custom group size" />
          <button className="chip" disabled={!custom || Number(custom) < 2} onClick={() => { patchStitchCounter(projectId, counter.id, { groupSize: Number(custom) }); setCustom(''); }}>Use</button>
        </div>
      </div>
      <button className="btn primary" disabled={!target || Number(target) < 1} onClick={() => { patchStitchCounter(projectId, counter.id, { target: Number(target) }); onClose(); }}>SAVE TARGET</button>
      <div className="row">
        <ConfirmButton label="RESET to 0" onConfirm={() => { resetStitches(projectId, counter.id); onClose(); }} />
        <span className="grow" />
        <ConfirmButton label="Delete" onConfirm={() => { deleteStitchCounter(projectId, counter.id); onClose(); }} />
      </div>
    </Sheet>
  );
}
