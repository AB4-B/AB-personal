import { useCallback, useEffect, useRef, useState } from 'react';
import { findInstruction } from '../model/helpers';
import { loadPdf, type PDFDocumentProxy } from '../pdf/pdfjs';
import { repo, setPdfPage, useStore } from '../store/store';
import { IconBack, IconPin } from '../ui/common';
import { go, useRoute } from '../ui/router';

interface PageDim { w: number; h: number }

export function PdfViewer({ projectId }: { projectId: string }) {
  const project = useStore((s) => s.projects[projectId]);
  const pattern = useStore((s) => (project ? s.patterns[project.patternId] : undefined));
  const route = useRoute();
  const scroller = useRef<HTMLDivElement>(null);
  const pagesEl = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy>();
  const [dims, setDims] = useState<PageDim[]>([]);
  const [zoom, setZoom] = useState(1);
  const [fitW, setFitW] = useState(0);
  const [cur, setCur] = useState(1);
  const [err, setErr] = useState('');
  const canvases = useRef(new Map<number, { canvas: HTMLCanvasElement; task?: { cancel(): void }; zoom: number }>());
  const startPage = useRef(Number(route.query.get('page')) || project?.progress.pdfPage || 1);
  const initialScrolled = useRef(false);

  // load the stored original PDF
  useEffect(() => {
    if (!pattern) return;
    let cancelled = false;
    void (async () => {
      try {
        const blob = await repo.getFile(pattern.fileId);
        if (!blob) throw new Error('The original PDF is missing from this device.');
        const d = await loadPdf(await blob.arrayBuffer());
        const ds: PageDim[] = [];
        for (let i = 1; i <= d.numPages; i++) {
          const v = (await d.getPage(i)).getViewport({ scale: 1 });
          ds.push({ w: v.width, h: v.height });
        }
        if (!cancelled) {
          setDoc(d);
          setDims(ds);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [pattern]);

  // fit width
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setFitW(Math.min(el.clientWidth - 16, 900));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc]);

  const cssW = fitW * zoom;
  const pageSize = (i: number) => {
    const d = dims[i];
    return d ? { w: cssW, h: (cssW * d.h) / d.w } : { w: cssW, h: cssW * 1.3 };
  };

  const render = useCallback(async (pageNo: number) => {
    if (!doc || !fitW) return;
    const holder = document.getElementById(`pdfpage-${pageNo}`);
    if (!holder) return;
    const dim = dims[pageNo - 1];
    if (!dim) return;
    let entry = canvases.current.get(pageNo);
    if (entry && entry.zoom === zoom) return;
    entry?.task?.cancel();
    const page = await doc.getPage(pageNo);
    const scale = (cssW / dim.w) * Math.min(window.devicePixelRatio || 1, 2);
    const vp = page.getViewport({ scale });
    const canvas = entry?.canvas ?? document.createElement('canvas');
    const off = document.createElement('canvas');
    off.width = Math.floor(vp.width);
    off.height = Math.floor(vp.height);
    const task = page.render({ canvas: off, viewport: vp } as never);
    entry = { canvas, task, zoom };
    canvases.current.set(pageNo, entry);
    try {
      await task.promise;
    } catch {
      return; // cancelled
    }
    canvas.width = off.width;
    canvas.height = off.height;
    canvas.getContext('2d')!.drawImage(off, 0, 0);
    if (!canvas.parentElement) holder.appendChild(canvas);
    holder.dataset.rendered = String(pageNo);
  }, [doc, dims, fitW, cssW, zoom]);

  // lazy render visible pages
  useEffect(() => {
    if (!doc || !fitW || !pagesEl.current) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) void render(Number((e.target as HTMLElement).dataset.page));
    }, { root: scroller.current, rootMargin: '1200px 0px' });
    pagesEl.current.querySelectorAll('[data-page]').forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [doc, fitW, render, dims]);

  // scroll to remembered/target page once layout exists
  useEffect(() => {
    if (!doc || !fitW || initialScrolled.current || !scroller.current) return;
    initialScrolled.current = true;
    requestAnimationFrame(() => document.getElementById(`pdfpage-${startPage.current}`)?.scrollIntoView({ block: 'start' }));
  }, [doc, fitW]);

  // track current page + remember it
  useEffect(() => {
    const el = scroller.current;
    if (!el || !doc) return;
    let timer = 0;
    const onScroll = () => {
      const mid = el.getBoundingClientRect().top + el.clientHeight * 0.35;
      let best = 1;
      pagesEl.current?.querySelectorAll<HTMLElement>('[data-page]').forEach((n) => {
        if (n.getBoundingClientRect().top <= mid) best = Number(n.dataset.page);
      });
      setCur(best);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setPdfPage(projectId, best), 350);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); window.clearTimeout(timer); };
  }, [doc, projectId]);

  // pinch zoom
  useEffect(() => {
    const el = scroller.current;
    const inner = pagesEl.current;
    if (!el || !inner) return;
    let d0 = 0, z0 = 1, scale = 1, cx = 0, cy = 0;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const start = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        d0 = dist(e.touches); z0 = zoomRef.current; scale = 1;
        const r = el.getBoundingClientRect();
        cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
        cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
        inner.style.transformOrigin = `${el.scrollLeft + cx}px ${el.scrollTop + cy}px`;
      }
    };
    const move = (e: TouchEvent) => {
      if (e.touches.length === 2 && d0) {
        e.preventDefault();
        scale = Math.max(0.5 / z0, Math.min(5 / z0, dist(e.touches) / d0));
        inner.style.transform = `scale(${scale})`;
      }
    };
    const end = () => {
      if (d0) {
        const nz = Math.max(0.5, Math.min(5, z0 * scale));
        inner.style.transform = '';
        const ratio = nz / z0;
        d0 = 0;
        setZoom(nz);
        requestAnimationFrame(() => {
          el.scrollLeft = (el.scrollLeft + cx) * ratio - cx;
          el.scrollTop = (el.scrollTop + cy) * ratio - cy;
        });
      }
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    return () => { el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move); el.removeEventListener('touchend', end); };
  }, [doc]);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const changeZoom = (f: number) => {
    const el = scroller.current;
    const nz = Math.max(0.5, Math.min(5, zoom * f));
    const ratio = nz / zoom;
    setZoom(nz);
    if (el) requestAnimationFrame(() => { el.scrollTop = (el.scrollTop + el.clientHeight / 2) * ratio - el.clientHeight / 2; });
  };

  if (!project || !pattern) return null;
  const curIns = findInstruction(pattern, project.progress.currentInstructionId);

  return (
    <div className="viewer" data-testid="pdf-viewer">
      <div className="vbar">
        <button className="iconbtn" aria-label="Back to instructions" onClick={() => go(`/p/${projectId}/outline`)}><IconBack /></button>
        <h1>{pattern.fileName}</h1>
        <span className="badge" data-testid="pdf-page">Page {cur}/{dims.length || pattern.pageCount}</span>
      </div>
      <div className="pdf-scroll" ref={scroller} data-testid="pdf-scroll">
        {err && <div className="empty" style={{ color: '#fff' }}>{err}</div>}
        {!doc && !err && <div className="empty" style={{ color: '#fff' }}>Opening PDF…</div>}
        <div className="pdf-pages" ref={pagesEl}>
          {dims.map((_, i) => {
            const s = pageSize(i);
            return <div key={i} id={`pdfpage-${i + 1}`} className="pdf-page" data-page={i + 1} style={{ width: s.w, height: s.h }} />;
          })}
        </div>
      </div>
      <div className="vfoot">
        <div className="zoomrow">
          <button className="btn small" onClick={() => changeZoom(1 / 1.3)} aria-label="Zoom out">−</button>
          <button className="btn small" onClick={() => setZoom(1)} aria-label="Fit width">Fit</button>
          <button className="btn small" onClick={() => changeZoom(1.3)} aria-label="Zoom in" data-testid="pdf-zoom-in">+</button>
          {curIns && (
            <button className="btn small" style={{ background: 'var(--gold)', borderColor: 'var(--gold)' }} onClick={() => document.getElementById(`pdfpage-${curIns.source.page}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })} data-testid="pdf-to-source"><IconPin /> Source page {curIns.source.page}</button>
          )}
        </div>
        <button className="btn primary block" onClick={() => go(`/p/${projectId}/outline?focus=1`)} data-testid="pdf-return">BACK TO INSTRUCTIONS</button>
      </div>
    </div>
  );
}
