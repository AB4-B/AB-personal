import { useEffect, useRef, useState } from 'react';
import { findInstruction } from '../model/helpers';
import { savePattern, useStore } from '../store/store';
import { IconBack, IconPin, useBlobUrl } from '../ui/common';
import { go } from '../ui/router';

interface View { s: number; x: number; y: number }

export function ChartViewer({ projectId, imageId }: { projectId: string; imageId: string }) {
  const project = useStore((s) => s.projects[projectId]);
  const pattern = useStore((s) => (project ? s.patterns[project.patternId] : undefined));
  const im = pattern?.images.find((i) => i.id === imageId);
  const url = useBlobUrl(im?.fileId);
  const stage = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const [v, setV] = useState<View>({ s: 1, x: 0, y: 0 });
  const vRef = useRef(v);
  vRef.current = v;
  const fit = useRef<View>({ s: 1, x: 0, y: 0 });

  const doFit = () => {
    const st = stage.current, el = img.current;
    if (!st || !el || !el.naturalWidth) return;
    const s = Math.min(st.clientWidth / el.naturalWidth, st.clientHeight / el.naturalHeight) * 0.98;
    const nv = { s, x: (st.clientWidth - el.naturalWidth * s) / 2, y: (st.clientHeight - el.naturalHeight * s) / 2 };
    fit.current = nv;
    setV(nv);
  };

  const zoomAt = (f: number, cx: number, cy: number) => {
    const c = vRef.current;
    const ns = Math.max(fit.current.s * 0.8, Math.min(fit.current.s * 12, c.s * f));
    const r = ns / c.s;
    setV({ s: ns, x: cx - (cx - c.x) * r, y: cy - (cy - c.y) * r });
  };

  useEffect(() => {
    const st = stage.current;
    if (!st) return;
    const pts = new Map<number, { x: number; y: number }>();
    let lastDist = 0, lastTap = 0;
    const rel = (e: PointerEvent) => { const r = st.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const down = (e: PointerEvent) => {
      st.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, rel(e));
      if (pts.size === 2) { const [a, b] = [...pts.values()]; lastDist = Math.hypot(a.x - b.x, a.y - b.y); }
      if (pts.size === 1) {
        const t = Date.now();
        if (t - lastTap < 280) {
          const p = rel(e);
          if (vRef.current.s > fit.current.s * 1.5) setV(fit.current); else zoomAt(3, p.x, p.y);
        }
        lastTap = t;
      }
    };
    const move = (e: PointerEvent) => {
      const prev = pts.get(e.pointerId);
      if (!prev) return;
      const p = rel(e);
      pts.set(e.pointerId, p);
      if (pts.size === 1) {
        setV((c) => ({ ...c, x: c.x + p.x - prev.x, y: c.y + p.y - prev.y }));
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastDist) zoomAt(d / lastDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
        lastDist = d;
      }
    };
    const up = (e: PointerEvent) => { pts.delete(e.pointerId); lastDist = 0; };
    const wheel = (e: WheelEvent) => { e.preventDefault(); const p = { x: e.clientX - st.getBoundingClientRect().left, y: e.clientY - st.getBoundingClientRect().top }; zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, p.x, p.y); };
    st.addEventListener('pointerdown', down);
    st.addEventListener('pointermove', move);
    st.addEventListener('pointerup', up);
    st.addEventListener('pointercancel', up);
    st.addEventListener('wheel', wheel, { passive: false });
    return () => { st.removeEventListener('pointerdown', down); st.removeEventListener('pointermove', move); st.removeEventListener('pointerup', up); st.removeEventListener('pointercancel', up); st.removeEventListener('wheel', wheel); };
  }, [url]);

  if (!project || !pattern || !im) return null;
  const cur = findInstruction(pattern, project.progress.currentInstructionId);
  const linked = cur?.source.imageIds.includes(im.id);
  const toggleLink = async () => {
    if (!cur) return;
    const next = structuredClone(pattern);
    const ins = next.instructions.find((i) => i.id === cur.id)!;
    ins.source.imageIds = linked ? ins.source.imageIds.filter((x) => x !== im.id) : [...ins.source.imageIds, im.id];
    await savePattern(next);
  };
  const stitchCtr = stage.current ? { x: stage.current.clientWidth / 2, y: stage.current.clientHeight / 2 } : { x: 150, y: 300 };

  return (
    <div className="viewer" data-testid="chart-viewer">
      <div className="vbar">
        <button className="iconbtn" aria-label="Back" onClick={() => history.back()}><IconBack /></button>
        <h1>{im.title}</h1>
        <button className="btn small" onClick={() => go(`/p/${projectId}/pdf?page=${im.page}`)}>PDF p{im.page}</button>
      </div>
      <div className="chart-stage" ref={stage} data-testid="chart-stage">
        {url ? (
          <img ref={img} src={url} alt={im.title} draggable={false} onLoad={doFit} style={{ transform: `translate(${v.x}px, ${v.y}px) scale(${v.s})` }} data-testid="chart-img" data-scale={v.s.toFixed(3)} />
        ) : (
          <div className="empty" style={{ color: '#fff' }}>Image not stored. Open the original PDF page instead.</div>
        )}
      </div>
      <div className="vfoot">
        <div className="zoomrow">
          <button className="btn small" onClick={() => zoomAt(1 / 1.4, stitchCtr.x, stitchCtr.y)} aria-label="Zoom out">−</button>
          <button className="btn small" onClick={doFit}>Fit</button>
          <button className="btn small" onClick={() => zoomAt(1.4, stitchCtr.x, stitchCtr.y)} aria-label="Zoom in" data-testid="chart-zoom-in">+</button>
          {cur && <button className="btn small" onClick={toggleLink} data-testid="link-chart">{linked ? 'Unlink from current' : 'Link to current'}</button>}
        </div>
        <button className="btn block" style={{ background: 'var(--gold)', borderColor: 'var(--gold)', color: '#3b2500' }} onClick={() => go(`/p/${projectId}/outline?focus=1`)} data-testid="chart-return"><IconPin /> BACK TO CURRENT INSTRUCTION</button>
      </div>
    </div>
  );
}
