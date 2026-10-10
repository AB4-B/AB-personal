import { useMemo, useState } from 'react';
import { InstructionSheet } from '../components/InstructionSheet';
import { useResolver } from '../components/Resolver';
import { analyzePattern, needsAttention, type CheckItem } from '../guidance/check';
import { acknowledgeCheck, saveGuidanceOverride, useStore } from '../store/store';
import type { Instruction, Pattern, Project } from '../model/types';
import { Sheet, TopBar } from '../ui/common';
import { go } from '../ui/router';

/** Summary of how much of the pattern the app understood. Used on the project screen and the check screen. */
export function useCheck(pattern: Pattern, project: Project) {
  return useMemo(
    () => analyzePattern(pattern, project),
    // the analysis depends on these parts of the project only
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pattern, project.size, project.sizeOverrides, project.knit?.guidanceOverrides, project.knit?.checked, project.prefs],
  );
}

function Tile({ id, label, value, tone }: { id: string; label: string; value: string | number; tone?: 'ok' | 'warn' }) {
  return (
    <div className={`tile2${tone === 'warn' ? ' tile-warn' : ''}`} data-testid={id}>
      <span className="tl">{tone === 'ok' ? '✓ ' : tone === 'warn' ? '⚠ ' : ''}{label}</span>
      <b data-testid={`${id}-n`}>{value}</b>
    </div>
  );
}

function InterpretSheet({ project, ins, onClose }: { project: Project; ins: Instruction; onClose: () => void }) {
  const existing = project.knit?.guidanceOverrides?.[ins.id]?.steps.join('\n') ?? '';
  const [text, setText] = useState(existing);
  const save = (steps: string[]) => {
    saveGuidanceOverride(project.id, ins.id, steps);
    onClose();
  };
  return (
    <Sheet title="My interpretation" onClose={onClose}>
      <div className="stack">
        <div className="card">
          <span className="pat-label">Pattern says (page {ins.source.page})</span>
          <div className="pre">{ins.text}</div>
        </div>
        <p className="muted small-text" style={{ margin: 0 }}>Type what you will do, one step per line. It is saved with this project and shown while you knit. The designer's pattern is not changed.</p>
        <textarea className="textarea" aria-label="My interpretation" data-testid="check-text" value={text} onChange={(e) => setText(e.target.value)} placeholder={'Knit 10 stitches.\nTurn your work.'} />
        <button className="btn primary" disabled={!text.trim()} data-testid="check-save" onClick={() => save(text.split('\n').map((x) => x.trim()).filter(Boolean))}>SAVE MY INTERPRETATION</button>
        <button className="btn soft" data-testid="check-follow-original" onClick={() => save([`Follow the original pattern for this step (page ${ins.source.page}).`, ins.text.replace(/\s+/g, ' ').trim()])}>I will follow the original for this step</button>
      </div>
    </Sheet>
  );
}

function ItemCard({ item, project, pattern }: { item: CheckItem; project: Project; pattern: Pattern }) {
  const [edit, setEdit] = useState(false);
  const [orig, setOrig] = useState(false);
  const resolver = useResolver(project, pattern);
  const kind = item.unsupported ? 'unsupported' : item.sizeValues.length ? 'size' : item.review ? 'review' : 'count';
  return (
    <div className="card stack" data-testid="check-item" data-kind={kind} data-ins={item.ins.id} style={{ gap: 8 }}>
      <div className="small-text muted">{item.title || 'Pattern'} · page {item.ins.source.page}{item.unsupported ? ` · ${item.unsupported}` : ''}</div>
      <blockquote className="says" style={{ margin: 0 }}>
        <span className="pat-label">PATTERN SAYS</span>
        {item.ins.text.replace(/\s+/g, ' ').slice(0, 320)}{item.ins.text.length > 320 ? '…' : ''}
      </blockquote>
      {item.reasons.map((r, i) => <div key={i} className="small-text">{r}</div>)}
      <div className="row wrap">
        {item.sizeValues.map((v) => (
          <button key={v.key} className="btn small" data-testid="check-choose" onClick={() => resolver.open(item.ins, v)}>Choose my value</button>
        ))}
        {(item.review || item.unsupported) && !item.sizeValues.length && <button className="btn small" data-testid="check-correct" onClick={() => setEdit(true)}>Correct this</button>}
        {item.count && !item.checked && <button className="btn small" data-testid="check-accept" onClick={() => acknowledgeCheck(project.id, item.ins.id, true)}>I checked it, it is fine</button>}
        {item.count && item.checked && <button className="btn small ghost" onClick={() => acknowledgeCheck(project.id, item.ins.id, false)}>Undo “checked”</button>}
        <button className="btn small ghost" onClick={() => setOrig(true)}>View original</button>
      </div>
      {edit && <InterpretSheet project={project} ins={item.ins} onClose={() => setEdit(false)} />}
      {orig && <InstructionSheet project={project} pattern={pattern} ins={item.ins} initialView="original" onClose={() => setOrig(false)} />}
      {resolver.sheet}
    </div>
  );
}

const GROUPS: { id: string; title: string; pick: (i: CheckItem) => boolean }[] = [
  { id: 'review', title: 'NEEDS REVIEW', pick: (i) => (i.review || i.sizeValues.length > 0) && !i.unsupported },
  { id: 'count', title: 'STITCH-COUNT DIFFERENCES', pick: (i) => i.count && !i.checked && !i.review && !i.unsupported && !i.sizeValues.length },
  { id: 'unsupported', title: 'UNSUPPORTED TECHNIQUES AND CHARTS', pick: (i) => !!i.unsupported },
];

export function PatternCheck({ projectId }: { projectId: string }) {
  const project = useStore((s) => s.projects[projectId]);
  const pattern = useStore((s) => (project ? s.patterns[project.patternId] : undefined));
  if (!project || !pattern) return <div className="screen"><TopBar title="Pattern check" onBack={() => go('/')} /><div className="empty">Project not found.</div></div>;
  return <CheckBody project={project} pattern={pattern} />;
}

function CheckBody({ project, pattern }: { project: Project; pattern: Pattern }) {
  const c = useCheck(pattern, project);
  const attention = c.items.filter(needsAttention).length;
  return (
    <div className="screen">
      <TopBar title="Pattern check" onBack={() => go(`/p/${project.id}`)} />
      <div className="page-pad stack" data-testid="pattern-check">
        <p className="small-text muted" style={{ margin: 0 }}>For size {project.size}. Nothing here needs approving: anything the app understood reliably is just counted. Only the steps it is unsure about are listed.</p>
        <div className="tiles">
          <Tile id="check-interpreted" label="Interpreted" value={`${c.interpreted} of ${c.total}`} tone="ok" />
          <Tile id="check-review" label="Needs review" value={c.needsReview} tone={c.needsReview ? 'warn' : undefined} />
          <Tile id="check-count" label="Stitch-count differences" value={c.countDifferences} tone={c.countDifferences ? 'warn' : undefined} />
          <Tile id="check-unsupported" label="Unsupported techniques or charts" value={c.unsupported} tone={c.unsupported ? 'warn' : undefined} />
        </div>
        {attention === 0 ? (
          <div className="done-banner" data-testid="check-clear">✓ Nothing needs your attention. You can start knitting.</div>
        ) : (
          <div className="warnbox" data-testid="check-attention">{attention} step{attention === 1 ? '' : 's'} need{attention === 1 ? 's' : ''} a look. You can start knitting at any time: these steps show the designer's own words until you correct them.</div>
        )}
        {GROUPS.map((g) => {
          const list = c.items.filter(g.pick);
          if (!list.length) return null;
          return (
            <section key={g.id} className="stack" data-testid={`check-group-${g.id}`}>
              <span className="caps">{g.title} ({list.length})</span>
              {list.map((i) => <ItemCard key={i.ins.id} item={i} project={project} pattern={pattern} />)}
            </section>
          );
        })}
        {(c.corrected.length > 0 || c.items.some((i) => i.count && i.checked)) && (
          <section className="stack" data-testid="check-corrected">
            <span className="caps">CORRECTED OR CHECKED BY YOU ({c.corrected.length + c.items.filter((i) => i.count && i.checked).length})</span>
            {c.corrected.map((ins) => (
              <div key={ins.id} className="card stack" data-testid="check-corrected-item" style={{ gap: 6 }}>
                <div className="small-text muted">Page {ins.source.page}</div>
                <div className="small-text">{project.knit?.guidanceOverrides?.[ins.id]?.steps.join(' · ')}</div>
                <button className="btn small ghost" onClick={() => saveGuidanceOverride(project.id, ins.id, null)}>Remove my correction</button>
              </div>
            ))}
            {c.items.filter((i) => i.count && i.checked).map((i) => <ItemCard key={i.ins.id} item={i} project={project} pattern={pattern} />)}
          </section>
        )}
        <button className="btn primary big block" data-testid="check-start" onClick={() => go(`/p/${project.id}/knit`)}>START KNITTING</button>
      </div>
    </div>
  );
}
