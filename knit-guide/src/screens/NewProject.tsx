import { useMemo, useState } from 'react';
import { detectSuggestions } from '../parser/detect';
import { editText, finalizePattern, ignoreSuggestion, mergeWithNext, removeSection, renameSection, setKind, setSectionLevel, splitInstruction, startSectionHere } from '../parser/edit';
import { suggestSetup } from '../parser/parse';
import { importPdf, importText, type ImportResult } from '../pdf/importPdf';
import { parseSizeList } from '../model/size';
import type { Abbreviation, ImageKind, Pattern, ProjectSetup } from '../model/types';
import { createProject } from '../store/store';
import { analyzeResolution, type ReviewValue } from '../model/guide';
import { projectFacts } from '../model/facts';
import { ResolveSheet } from '../components/RichText';
import type { Instruction } from '../model/types';
import { PhotoInput, TopBar, YarnIcon } from '../ui/common';
import { go } from '../ui/router';

type Step = 'upload' | 'parsing' | 'review' | 'setup' | 'creating';
type Tab = 'details' | 'size' | 'outline' | 'images' | 'abbr';

function Field({ label, children, id }: { label: string; children: React.ReactNode; id?: string }) {
  return <div className="field"><label htmlFor={id}>{label}</label>{children}</div>;
}

export function NewProject() {
  const [step, setStep] = useState<Step>('upload');
  const [msg, setMsg] = useState('');
  const [frac, setFrac] = useState(0);
  const [err, setErr] = useState('');
  const [draft, setDraft] = useState<ImportResult>();
  const [pattern, setPattern] = useState<Pattern>();
  const [size, setSizeState] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  /** a different size means different values, so hand-confirmed values are cleared with it */
  const setSize = (z: string) => {
    if (z !== size) setOverrides({});
    setSizeState(z);
  };
  const [paste, setPaste] = useState('');
  const [pasteTitle, setPasteTitle] = useState('');

  const onPaste = () => {
    setErr('');
    try {
      const r = importText(paste, pasteTitle);
      setDraft(r);
      setPattern(r.pattern);
      setSizeState(r.pattern.suggestedSize ?? '');
      setStep('review');
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : 'Could not read this text.');
    }
  };

  const onFile = async (f: File) => {
    setErr('');
    setStep('parsing');
    try {
      const r = await importPdf(f, (m, p) => { setMsg(m); setFrac(p); });
      setDraft(r);
      setPattern(r.pattern);
      setSizeState(r.pattern.suggestedSize ?? '');
      setStep('review');
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : 'Could not read this PDF.');
      setStep('upload');
    }
  };

  if (step === 'upload' || step === 'parsing') {
    return (
      <div className="screen">
        <TopBar title="New project" onBack={() => go('/')} />
        <div className="page-pad stack" style={{ gap: 18 }}>
          <div className="card stack" style={{ alignItems: 'center', textAlign: 'center', padding: 28 }}>
            <YarnIcon size={72} />
            <h2>Upload a pattern PDF</h2>
            <p className="muted" style={{ margin: 0 }}>The PDF is stored only on this device and stays exactly as you uploaded it. Knit Guide reads it to build a guided project, then you check the result.</p>
            {step === 'upload' ? (
              <label className="btn primary big block" style={{ cursor: 'pointer' }}>
                CHOOSE PDF
                <input type="file" accept="application/pdf,.pdf" hidden data-testid="pdf-input" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} />
              </label>
            ) : (
              <div className="stack" style={{ alignItems: 'center', width: '100%' }} data-testid="parsing">
                <div className="spinner" />
                <b>{msg || 'Working…'}</b>
                <div className="progress" style={{ width: '100%' }}><i style={{ width: `${frac * 100}%` }} /></div>
              </div>
            )}
          </div>
          {step === 'upload' && (
            <div className="card stack">
              <h2>Or paste the pattern text</h2>
              <p className="muted small-text" style={{ margin: 0 }}>
                For patterns you can't download. Copy the whole pattern page (sizes, yarn, gauge and instructions) and paste it here. Your pasted text is kept exactly as pasted; menus, ads and repeated banners are only hidden from the guide.
              </p>
              <textarea className="textarea" style={{ minHeight: 150 }} placeholder="Paste pattern text here" value={paste} onChange={(e) => setPaste(e.target.value)} data-testid="paste-input" aria-label="Pasted pattern text" />
              <input className="input" placeholder="Pattern name (optional)" value={pasteTitle} onChange={(e) => setPasteTitle(e.target.value)} aria-label="Pattern name" />
              <button className="btn primary" disabled={paste.trim().length < 80} onClick={onPaste} data-testid="paste-read">READ PASTED TEXT</button>
            </div>
          )}
          {err && <div className="warnbox">{err}</div>}
          <p className="muted small-text">Parsing is rule-based and runs offline in your browser. It will not be perfect, so you review it before knitting.</p>
        </div>
      </div>
    );
  }
  if (!pattern || !draft) return null;

  if (step === 'review') {
    return <Review pattern={pattern} setPattern={setPattern} draft={draft} size={size} setSize={setSize} overrides={overrides} setOverrides={setOverrides} onContinue={() => { setPattern(finalizePattern(pattern)); setStep('setup'); }} onCancel={() => go('/')} />;
  }
  return (
    <Setup
      pattern={pattern}
      draft={draft}
      size={size}
      setSize={setSize}
      overrides={overrides}
      setOverrides={setOverrides}
      busy={step === 'creating'}
      onBack={() => setStep('review')}
      onCreate={async (input) => {
        setStep('creating');
        const p = await createProject({ pattern, fileBlob: draft.fileBlob, imageBlobs: draft.imageBlobs, sizeOverrides: overrides, ...input });
        go(`/p/${p.id}`, true);
      }}
    />
  );
}

/* ---------------------------------------------------------------- review */

function Review({ pattern: p, setPattern, draft, size, setSize, overrides, setOverrides, onContinue, onCancel }: { pattern: Pattern; setPattern: (p: Pattern) => void; draft: ImportResult; size: string; setSize: (z: string) => void; overrides: Record<string, string>; setOverrides: (o: Record<string, string>) => void; onContinue: () => void; onCancel: () => void }) {
  const [tab, setTab] = useState<Tab>('details');
  const [sizesText, setSizesText] = useState(p.sizes.join(', '));
  const fin = useMemo(() => finalizePattern(p), [p]);
  const warnings = fin.parse.warnings.filter((w) => w.level === 'needs-review' && !/numbers but the pattern has/.test(w.message));
  const [showWarn, setShowWarn] = useState(false);
  const imgUrls = useMemo(() => Object.fromEntries(Object.entries(draft.imageBlobs).map(([k, b]) => [k, URL.createObjectURL(b)])), [draft]);
  const upd = (patch: Partial<Pattern>) => setPattern({ ...p, ...patch });

  return (
    <div className="screen" data-testid="review">
      <TopBar title="Review import" onBack={onCancel} />
      <div className="page-pad" style={{ paddingBottom: 0 }}>
        <div className="warnbox" style={{ background: 'var(--soft)', borderColor: 'var(--line)', color: 'var(--ink)' }}>
          Parsing is never perfect. The PDF is the source of truth: check these fields before knitting.
          {warnings.length > 0 && (
            <button className="badge review" style={{ marginLeft: 8 }} onClick={() => setShowWarn((v) => !v)} data-testid="warning-count">{warnings.length} NEED REVIEW</button>
          )}
        </div>
        {showWarn && (
          <div className="warnbox stack" style={{ marginTop: 8, gap: 6 }}>
            {warnings.map((w) => <div key={w.id}>• {w.message}{w.page ? ` (p${w.page})` : ''}</div>)}
          </div>
        )}
      </div>
      <div className="tabs" role="tablist" style={{ paddingTop: 10 }}>
        {([['details', 'Details'], ['size', 'Size check'], ['outline', 'Outline'], ['images', 'Charts & images'], ['abbr', 'Abbreviations']] as [Tab, string][]).map(([k, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)} data-testid={`tab-${k}`}>{n}</button>
        ))}
      </div>

      <div className="page-pad stack" style={{ paddingBottom: 120 }}>
        {tab === 'details' && (
          <>
            <Field label="Title" id="rt"><input id="rt" className="input" value={p.title} onChange={(e) => upd({ title: e.target.value })} /></Field>
            <Field label="Designer" id="rd"><input id="rd" className="input" value={p.designer} onChange={(e) => upd({ designer: e.target.value })} /></Field>
            <Field label="Sizes (comma separated)" id="rs">
              <input id="rs" className="input" value={sizesText} data-testid="sizes-input" onChange={(e) => { setSizesText(e.target.value); upd({ sizes: parseSizeList(e.target.value) }); }} />
              <span className="tiny muted">{p.sizes.length} sizes detected. Number lists like 50 [50, 54, …] are matched to this count.</span>
            </Field>
            <section className="card stack">
              <b>Finished measurements</b>
              {p.measurements.map((m, i) => (
                <div className="stack" key={m.id} style={{ gap: 6 }}>
                  <input className="input" aria-label="Measurement name" value={m.label} onChange={(e) => upd({ measurements: p.measurements.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} />
                  <input className="input" aria-label={`${m.label} inches`} placeholder="inches, comma separated" value={(m.inches ?? []).join(', ')} onChange={(e) => upd({ measurements: p.measurements.map((x, k) => (k === i ? { ...x, inches: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } : x)) })} />
                  <input className="input" aria-label={`${m.label} cm`} placeholder="cm, comma separated" value={(m.cm ?? []).join(', ')} onChange={(e) => upd({ measurements: p.measurements.map((x, k) => (k === i ? { ...x, cm: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } : x)) })} />
                  <div className="tiny muted">As printed: {m.raw}</div>
                </div>
              ))}
              <button className="btn soft small" onClick={() => upd({ measurements: [...p.measurements, { id: `m${p.measurements.length + 1}`, label: 'Length', raw: '', page: 1 }] })}>+ Add measurement</button>
            </section>
            <Field label="Yarn / materials (as printed)" id="ry"><textarea id="ry" className="textarea" value={p.yarn.description} onChange={(e) => upd({ yarn: { ...p.yarn, description: e.target.value, requirements: e.target.value } })} /></Field>
            <Field label="Needles" id="rn"><input id="rn" className="input" value={p.needles} onChange={(e) => upd({ needles: e.target.value })} /></Field>
            <Field label="Gauge (as printed)" id="rg"><input id="rg" className="input" value={p.gauge.raw} onChange={(e) => upd({ gauge: { ...p.gauge, raw: e.target.value } })} /></Field>
            <div className="row">
              <Field label="Stitches"><input className="input" inputMode="decimal" value={p.gauge.stitches ?? ''} onChange={(e) => upd({ gauge: { ...p.gauge, stitches: e.target.value ? Number(e.target.value) : undefined } })} aria-label="Gauge stitches" /></Field>
              <Field label="Rows"><input className="input" inputMode="decimal" value={p.gauge.rows ?? ''} onChange={(e) => upd({ gauge: { ...p.gauge, rows: e.target.value ? Number(e.target.value) : undefined } })} aria-label="Gauge rows" /></Field>
            </div>
          </>
        )}

        {tab === 'size' && (
          <>
            <p className="muted small-text" style={{ margin: 0 }}>Once you pick a size the guide becomes a single-size, metric pattern. Check that every size-dependent number could be mapped before you start knitting.</p>
            <SizeChoice pattern={fin} size={size} setSize={setSize} />
            <ResolutionPanel pattern={fin} size={size} overrides={overrides} setOverrides={setOverrides} />
          </>
        )}

        {tab === 'outline' && (
          <>
            <p className="muted small-text" style={{ margin: 0 }}>Headings and instruction boundaries as detected. Fix them here. Each item keeps its PDF page.</p>
            {p.sections.map((s) => {
              const list = p.instructions.filter((i) => i.sectionId === s.id && i.kind !== 'tracker');
              return (
                <section key={s.id} className="card stack" data-testid="rv-section">
                  <div className="row">
                    <input className="input grow" aria-label="Section heading" value={s.title} onChange={(e) => setPattern(renameSection(p, s.id, e.target.value))} />
                    <button className="chip" onClick={() => setPattern(setSectionLevel(p, s.id, s.level === 1 ? 2 : 1))}>{s.level === 1 ? 'Level 1' : 'Level 2'}</button>
                  </div>
                  <div className="row"><span className="tiny muted grow">p{s.page} · {list.length} items</span><button className="btn ghost small" onClick={() => setPattern(removeSection(p, s.id))} disabled={p.sections[0].id === s.id}>Remove heading</button></div>
                  {list.map((ins) => {
                    const sugg = detectSuggestions(ins.text, p.sizes.length);
                    const ignored = new Set(ins.ignoredSuggestions ?? []);
                    return (
                      <div className="rv-ins" key={ins.id} data-testid="rv-ins">
                        <textarea className="textarea" rows={Math.min(14, Math.max(2, ins.text.split('\n').reduce((n, l) => n + Math.ceil(l.length / 34), 0)))} style={{ minHeight: 70 }} value={ins.text} onChange={(e) => setPattern(editText(p, ins.id, e.target.value))} aria-label="Instruction text" />
                        <div className="row wrap">
                          <span className="tiny muted">p{ins.source.page}</span>
                          {ins.kind !== 'stitch-pattern' && (
                            <button className="chip" onClick={() => setPattern(setKind(p, ins.id, ins.kind === 'action' ? 'info' : 'action'))}>{ins.kind === 'action' ? 'Instruction' : 'Info only'}</button>
                          )}
                          <button className="chip" onClick={() => setPattern(splitInstruction(p, ins.id))}>Split sentences</button>
                          <button className="chip" onClick={() => setPattern(mergeWithNext(p, ins.id))}>Merge with next</button>
                          <button className="chip" onClick={() => { const t = prompt('New section heading'); if (t?.trim()) setPattern(startSectionHere(p, ins.id, t.trim(), 1)); }}>New section here</button>
                        </div>
                        {sugg.length > 0 && (
                          <div className="chips" style={{ marginTop: 0 }}>
                            {sugg.map((g, i) => (
                              <button key={i} className={`chip ${ignored.has(g.evidence) ? '' : 'suggest'}`} style={ignored.has(g.evidence) ? { textDecoration: 'line-through', opacity: .5 } : undefined} onClick={() => setPattern(ignoreSuggestion(p, ins.id, g.evidence, !ignored.has(g.evidence)))} title="Tap to ignore or restore this detected counter">
                                {g.kind === 'stitch' ? '🧶' : '🔢'} {g.label}: {g.perSize ? g.values.join('/') : g.values[0]}
                              </button>
                            ))}
                          </div>
                        )}
                        {ins.review && <div className="warnbox"><span className="badge review">NEEDS REVIEW</span> {ins.review.join(' ')}</div>}
                        {(ins.source.lines.join(' ') !== ins.text.replace(/\n/g, ' ') && ins.source.lines.length > 0) && (
                          <details><summary className="tiny muted">Original PDF text</summary><div className="pre small-text">{ins.source.lines.join('\n')}</div></details>
                        )}
                      </div>
                    );
                  })}
                </section>
              );
            })}
          </>
        )}

        {tab === 'images' && (
          <>
            <p className="muted small-text" style={{ margin: 0 }}>Charts stay as pictures cropped from your PDF. The app never redraws them.</p>
            {p.images.map((im) => (
              <div className="card stack" key={im.id} data-testid="rv-image">
                {im.fileId && imgUrls[im.fileId] && <img src={imgUrls[im.fileId]} alt={im.title} style={{ maxHeight: 180, objectFit: 'contain', background: '#fff', borderRadius: 10 }} />}
                <input className="input" value={im.title} aria-label="Image title" onChange={(e) => setPattern({ ...p, images: p.images.map((x) => (x.id === im.id ? { ...x, title: e.target.value } : x)) })} />
                <div className="row wrap">
                  <select className="select" style={{ width: 'auto' }} aria-label="Image type" value={im.kind} onChange={(e) => setPattern({ ...p, images: p.images.map((x) => (x.id === im.id ? { ...x, kind: e.target.value as ImageKind } : x)) })}>
                    <option value="chart">Chart</option><option value="diagram">Diagram</option><option value="photo">Photo</option><option value="ignore">Ignore</option>
                  </select>
                  <span className="tiny muted">page {im.page}</span>
                </div>
              </div>
            ))}
            {p.images.length === 0 && <div className="empty">{p.sourceType === 'text' ? 'Pasted text has no images.' : 'No images found.'}</div>}
          </>
        )}

        {tab === 'abbr' && (
          <>
            {p.abbreviations.map((a, i) => (
              <div className="card stack" key={i} style={{ gap: 6 }}>
                <div className="row">
                  <input className="input" style={{ width: 110 }} value={a.abbr} aria-label="Abbreviation" onChange={(e) => upd({ abbreviations: p.abbreviations.map((x, k): Abbreviation => (k === i ? { ...x, abbr: e.target.value } : x)) })} />
                  <button className="btn ghost small" onClick={() => upd({ abbreviations: p.abbreviations.filter((_, k) => k !== i) })}>Remove</button>
                </div>
                <textarea className="textarea" style={{ minHeight: 56 }} value={a.definition} aria-label="Definition" onChange={(e) => upd({ abbreviations: p.abbreviations.map((x, k): Abbreviation => (k === i ? { ...x, definition: e.target.value } : x)) })} />
              </div>
            ))}
            <button className="btn soft" onClick={() => upd({ abbreviations: [...p.abbreviations, { abbr: '', definition: '', page: 1 }] })}>+ Add abbreviation</button>
          </>
        )}
      </div>

      <div className="dock"><button className="btn primary big" style={{ flex: 1, maxWidth: 460 }} onClick={onContinue} data-testid="review-continue">CONTINUE TO SETUP</button></div>
    </div>
  );
}

/* ----------------------------------------------------------------- setup */

function Setup({ pattern, draft, size, setSize, overrides, setOverrides, busy, onBack, onCreate }: { pattern: Pattern; draft: ImportResult; size: string; setSize: (z: string) => void; overrides: Record<string, string>; setOverrides: (o: Record<string, string>) => void; busy: boolean; onBack: () => void; onCreate: (i: { name: string; size: string; setup: ProjectSetup; modification?: string; photoBlob?: Blob }) => void }) {
  const sug = suggestSetup(pattern);
  const [name, setName] = useState(pattern.title);
  const [setup, setSetup] = useState<ProjectSetup>({ yarn: sug.yarn, colour: sug.colour, needle: sug.needle, gaugeSts: '', gaugeRows: '', bodyLength: '', sleeveLength: '' });
  const [mod, setMod] = useState('');
  const [photo, setPhoto] = useState<Blob>();
  const photoImg = pattern.images.find((i) => i.kind === 'photo' && i.fileId && draft.imageBlobs[i.fileId]);
  const set = (k: keyof ProjectSetup) => (e: React.ChangeEvent<HTMLInputElement>) => setSetup({ ...setup, [k]: e.target.value });
  const canCreate = !!name.trim() && (pattern.sizes.length === 0 || !!size);

  return (
    <div className="screen" data-testid="setup">
      <TopBar title="Project setup" onBack={onBack} />
      <div className="page-pad stack" style={{ gap: 16, paddingBottom: 120 }}>
        <Field label="Project name" id="pn"><input id="pn" className="input" value={name} onChange={(e) => setName(e.target.value)} data-testid="project-name" /></Field>

        <SizeChoice pattern={pattern} size={size} setSize={setSize} />
        <ResolutionPanel pattern={pattern} size={size} overrides={overrides} setOverrides={setOverrides} />

        <section className="card stack">
          <b>Your materials</b>
          <Field label="Yarn" id="sy"><input id="sy" className="input" value={setup.yarn} onChange={set('yarn')} /></Field>
          <Field label="Colour" id="sc"><input id="sc" className="input" value={setup.colour} onChange={set('colour')} /></Field>
          <Field label="Needle size" id="sn"><input id="sn" className="input" value={setup.needle} onChange={set('needle')} /></Field>
          <div className="row">
            <Field label='My stitches / 4"'><input className="input" inputMode="decimal" value={setup.gaugeSts} onChange={set('gaugeSts')} aria-label="My gauge stitches" /></Field>
            <Field label='My rows / 4"'><input className="input" inputMode="decimal" value={setup.gaugeRows} onChange={set('gaugeRows')} aria-label="My gauge rows" /></Field>
          </div>
          <span className="tiny muted">Pattern gauge: {projectFacts(pattern, size || pattern.sizes[0] || '').gauge ?? 'not found'}</span>
        </section>

        <section className="card stack">
          <b>Lengths</b>
          <Field label="Intended body length" id="bl"><input id="bl" className="input" value={setup.bodyLength} onChange={set('bodyLength')} placeholder="e.g. 26 in, mid-thigh" /></Field>
          <Field label="Intended sleeve length" id="sl"><input id="sl" className="input" value={setup.sleeveLength} onChange={set('sleeveLength')} /></Field>
          <Field label="Modifications (optional)" id="md"><textarea id="md" className="textarea" value={mod} onChange={(e) => setMod(e.target.value)} placeholder="e.g. Make this a long cardigan. Aim for mid-thigh." /></Field>
        </section>

        <section className="card stack">
          <b>Project photo (optional)</b>
          <div className="row wrap">
            <PhotoInput onPick={setPhoto}>{photo ? 'Change photo' : 'Choose photo'}</PhotoInput>
            {photoImg && !photo && <button className="btn soft" onClick={() => setPhoto(draft.imageBlobs[photoImg.fileId!])}>Use photo from pattern</button>}
            {photo && <button className="btn ghost" onClick={() => setPhoto(undefined)}>Remove</button>}
          </div>
          {photo && <span className="tiny muted">Photo selected.</span>}
        </section>
      </div>
      <div className="dock">
        <button className="btn primary big" style={{ flex: 1, maxWidth: 460 }} disabled={!canCreate || busy} onClick={() => onCreate({ name: name.trim(), size, setup, modification: mod.trim() || undefined, photoBlob: photo })} data-testid="create-project">
          {busy ? 'CREATING…' : 'CREATE GUIDED PROJECT'}
        </button>
      </div>
    </div>
  );
}


/* -------------------------------------------------------- size + resolution */

function SizeChoice({ pattern, size, setSize }: { pattern: Pattern; size: string; setSize: (z: string) => void }) {
  return (
    <div className="field">
      <label>Choose your size</label>
      {pattern.suggestedSize && size === pattern.suggestedSize && <span className="tiny muted">Size {pattern.suggestedSize} was highlighted in your source. Change it if you are knitting another size.</span>}
      {pattern.sizes.length === 0 && <div className="warnbox">No sizes were detected. Add them under Details.</div>}
      <div className="size-pick" data-testid="size-pick">
        {pattern.sizes.map((z) => {
          const m = projectFacts(pattern, z).measurements[0];
          return (
            <button key={z} className={`size-btn ${size === z ? 'on' : ''}`} onClick={() => setSize(z)} data-testid={`size-${z}`} aria-pressed={size === z}>
              <b>{z}</b>
              {m && <span className="small-text">{m.label} {m.value}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** SIZE RESOLUTION: what could be mapped to the chosen size, and what needs the knitter. */
function ResolutionPanel({ pattern, size, overrides, setOverrides }: { pattern: Pattern; size: string; overrides: Record<string, string>; setOverrides: (o: Record<string, string>) => void }) {
  const [t, setT] = useState<{ ins: Instruction; review: ReviewValue }>();
  if (!size) return <div className="warnbox" data-testid="size-resolution">Choose a size to check which numbers can be resolved.</div>;
  const r = analyzeResolution(pattern, size, overrides);
  const n = r.needsReview.length;
  return (
    <div className="card stack" data-testid="size-resolution">
      <b>SIZE RESOLUTION · size {size}</b>
      <div data-testid="res-ok">✓ {r.resolved} size-dependent values resolved</div>
      {n > 0 && <div data-testid="res-warn" style={{ color: 'var(--warn-ink)', fontWeight: 700 }}>⚠ {n} need review</div>}
      {r.hiddenInstructions > 0 && <div className="muted small-text">{r.hiddenInstructions} instruction{r.hiddenInstructions === 1 ? ' is' : 's are'} written only for other sizes and left out of your guide (still in the original).</div>}
      {r.measurementFlags > 0 && <div style={{ color: 'var(--warn-ink)', fontWeight: 700 }}>⚠ MEASUREMENT NEEDS REVIEW ({r.measurementFlags})</div>}
      {r.needsReview.map(({ ins, review }) => (
        <div className="warnbox review-box stack" style={{ gap: 6 }} key={review.key} data-testid="res-item">
          <b>⚠ SIZE VALUE NEEDS REVIEW</b>
          <span>{review.reason}</span>
          <span className="pat-label">Original</span>
          <span className="pre">{ins.text}</span>
          <button className="btn small" onClick={() => setT({ ins, review })} data-testid="res-choose">CHOOSE MY VALUE</button>
        </div>
      ))}
      {n === 0 && <div className="done-banner" data-testid="res-all">✓ All size-dependent instructions resolved for Size {size}</div>}
      {t && (
        <ResolveSheet
          ins={t.ins}
          review={t.review}
          size={size}
          current={overrides[t.review.key]}
          onSave={(k, v) => {
            const next = { ...overrides };
            if (v === null) delete next[k];
            else next[k] = v;
            setOverrides(next);
          }}
          onClose={() => setT(undefined)}
        />
      )}
    </div>
  );
}
