import { useEffect, useRef, useState } from 'react';
import { findInstruction } from '../model/helpers';
import { repo, setSourceScroll, useStore } from '../store/store';
import { IconBack, IconPin } from '../ui/common';
import { go } from '../ui/router';

/** Source viewer for patterns imported by copy-and-paste: the untouched pasted text. */
export function TextViewer({ projectId }: { projectId: string }) {
  const project = useStore((s) => s.projects[projectId]);
  const pattern = useStore((s) => (project ? s.patterns[project.patternId] : undefined));
  const [text, setText] = useState<string>();
  const scroller = useRef<HTMLDivElement>(null);
  const restored = useRef(false);

  useEffect(() => {
    if (!pattern) return;
    void repo.getFile(pattern.fileId).then(async (b) => setText(b ? await b.text() : 'The original text is missing from this device.'));
  }, [pattern]);

  const cur = pattern && findInstruction(pattern, project?.progress.currentInstructionId);
  const hit = new Set((cur?.source.lines ?? []).flatMap((l) => l.split('\n')).map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 8));

  useEffect(() => {
    const el = scroller.current;
    if (!el || text === undefined || restored.current) return;
    restored.current = true;
    requestAnimationFrame(() => {
      const f = project?.progress.sourceScroll;
      if (f) el.scrollTop = f * (el.scrollHeight - el.clientHeight);
    });
  }, [text, project?.progress.sourceScroll]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let t = 0;
    const on = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => setSourceScroll(projectId, el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight)), 300);
    };
    el.addEventListener('scroll', on, { passive: true });
    return () => { el.removeEventListener('scroll', on); window.clearTimeout(t); };
  }, [projectId, text]);

  if (!project || !pattern) return null;
  const lines = (text ?? '').split('\n');
  const jump = () => scroller.current?.querySelector('.srcline.hit')?.scrollIntoView({ block: 'center', behavior: 'smooth' });

  return (
    <div className="viewer" style={{ background: 'var(--bg)' }} data-testid="text-viewer">
      <div className="vbar">
        <button className="iconbtn" aria-label="Back to instructions" onClick={() => go(`/p/${projectId}/outline`)}><IconBack /></button>
        <h1>Original text</h1>
        <span className="badge">Pasted</span>
      </div>
      <div className="textsrc" ref={scroller} data-testid="text-scroll">
        {lines.map((l, i) => (
          <div key={i} className={`srcline ${hit.has(l.replace(/\s+/g, ' ').trim()) ? 'hit' : ''}`}>{l || ' '}</div>
        ))}
      </div>
      <div className="vfoot">
        <div className="zoomrow">
          {cur && <button className="btn small" style={{ background: 'var(--gold)', borderColor: 'var(--gold)' }} onClick={jump} data-testid="text-to-source"><IconPin /> Current instruction</button>}
        </div>
        <button className="btn primary block" onClick={() => go(`/p/${projectId}/outline?focus=1`)} data-testid="text-return">BACK TO INSTRUCTIONS</button>
      </div>
    </div>
  );
}
