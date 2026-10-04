import { useEffect, useRef, useState, type ReactNode } from 'react';
import { repo } from '../store/store';
import { back } from './router';

/* ---- icons (own simple line icons) */
const I = (d: string, extra = '') => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d + extra }} />
);
export const IconBack = () => I('<path d="M15 5l-7 7 7 7"/>');
export const IconClose = () => I('<path d="M6 6l12 12M18 6L6 18"/>');
export const IconChevron = () => <svg className="chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>;
export const IconPdf = () => I('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>');
export const IconMore = () => I('<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>');
export const IconPlus = () => I('<path d="M12 5v14M5 12h14"/>');
export const IconCamera = () => I('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>');
export const IconPin = () => I('<path d="M12 21s-6-5.5-6-10a6 6 0 0112 0c0 4.5-6 10-6 10z"/><circle cx="12" cy="11" r="2"/>');
export const IconStop = () => I('<rect x="6" y="6" width="12" height="12" rx="2"/>');

export function TopBar({ title, onBack, right }: { title: ReactNode; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className="topbar">
      <button className="iconbtn" aria-label="Back" onClick={onBack ?? back}>
        <IconBack />
      </button>
      <h1>{title}</h1>
      {right}
    </header>
  );
}

export function Sheet({ title, onClose, onBack, children }: { title: ReactNode; onClose: () => void; onBack?: () => void; children: ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => void (document.body.style.overflow = prev);
  }, []);
  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="grab" />
        <div className="sheet-head">
          {onBack && (
            <button className="iconbtn" aria-label="Back" onClick={onBack}>
              <IconBack />
            </button>
          )}
          <h2>{title}</h2>
          <button className="iconbtn" aria-label="Close" onClick={onClose}>
            <IconClose />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </>
  );
}

/** Two-step button: first tap arms it, second tap (within 3s) confirms. Prevents accidental resets. */
export function ConfirmButton({ label, confirmLabel = 'Tap again to confirm', onConfirm, className = 'btn small danger' }: { label: ReactNode; confirmLabel?: string; onConfirm: () => void; className?: string }) {
  const [armed, setArmed] = useState(false);
  const t = useRef<number>(0);
  useEffect(() => () => window.clearTimeout(t.current), []);
  return (
    <button
      className={className}
      onClick={() => {
        if (armed) {
          window.clearTimeout(t.current);
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
          t.current = window.setTimeout(() => setArmed(false), 3000);
        }
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

export function useBlobUrl(fileId?: string): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let revoked = false;
    let u: string | undefined;
    setUrl(undefined);
    if (!fileId) return;
    void repo.getFile(fileId).then((b) => {
      if (b && !revoked) {
        u = URL.createObjectURL(b);
        setUrl(u);
      }
    });
    return () => {
      revoked = true;
      if (u) URL.revokeObjectURL(u);
    };
  }, [fileId]);
  return url;
}

let toastSetter: ((m: string) => void) | undefined;
export function toast(msg: string) {
  toastSetter?.(msg);
}
export function ToastHost() {
  const [msg, setMsg] = useState('');
  useEffect(() => {
    toastSetter = (m) => {
      setMsg(m);
      window.setTimeout(() => setMsg((cur) => (cur === m ? '' : cur)), 2200);
    };
    return () => void (toastSetter = undefined);
  }, []);
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}

/** Downscale a chosen photo to keep storage small. */
export async function resizeImage(file: Blob, max = 1200): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('resize failed'))), 'image/jpeg', 0.85));
}

export function PhotoInput({ onPick, children, className = 'btn soft' }: { onPick: (b: Blob) => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className={className} onClick={() => ref.current?.click()}>
        {children}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        hidden
        data-testid="photo-input"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onPick(await resizeImage(f));
        }}
      />
    </>
  );
}

export function YarnIcon({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke="var(--text-2)" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
      <circle cx="30" cy="32" r="20" fill="var(--primary-light)" />
      <path d="M12 26c14 4 28 0 36-8M11 36c16 5 30 1 39-8M14 46c14 3 26-1 33-8M24 14c-4 12-3 26 4 38M36 13c-4 12-3 26 3 38" />
      <path d="M48 44c6 2 10 6 12 12" />
    </svg>
  );
}
