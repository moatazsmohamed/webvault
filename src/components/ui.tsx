'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import { DICT, dirOf, translate, type DictKey } from '@/lib/i18n';
import type { Locale, WebsiteStatus } from '@/lib/types';

/* ── locale ────────────────────────────────────────────────────────────────── */

type LocaleValue = { locale: Locale; dir: 'rtl' | 'ltr'; t: (key: DictKey, vars?: Record<string, string | number>) => string };
const LocaleCtx = createContext<LocaleValue>({ locale: 'ar', dir: 'rtl', t: k => DICT[k].ar });
export const useLocale = () => useContext(LocaleCtx);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo<LocaleValue>(
    () => ({ locale, dir: dirOf(locale), t: (key, vars) => translate(locale, key, vars) }),
    [locale],
  );
  return <LocaleCtx.Provider value={value}>{children}</LocaleCtx.Provider>;
}

/* ── toasts ───────────────────────────────────────────────────────────────── */

type ToastKind = 'ok' | 'bad' | 'info';
type Toast = { id: number; kind: ToastKind; text: string };
const ToastCtx = createContext<{ push: (kind: ToastKind, text: string) => void }>({ push: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const timers = useRef<number[]>([]);

  const push = useCallback((kind: ToastKind, text: string) => {
    seq.current += 1;
    const id = seq.current;
    setItems(prev => [...prev.slice(-3), { id, kind, text }]);
    const timer = window.setTimeout(() => setItems(prev => prev.filter(x => x.id !== id)), 4200);
    timers.current.push(timer);
  }, []);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const tone: Record<ToastKind, string> = { ok: 'var(--ok)', bad: 'var(--bad)', info: 'var(--accent)' };
  const glyph: Record<ToastKind, IconName> = { ok: 'check', bad: 'alert', info: 'spark' };

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 z-[80] flex w-[min(92vw,22rem)] flex-col gap-2 ltr:right-4 rtl:left-4 sm:bottom-6">
        {items.map(item => (
          <div
            key={item.id}
            role="status"
            className="card pointer-events-auto flex animate-pop-in items-center gap-2.5 px-3.5 py-3 text-sm shadow-pop"
            style={{ borderColor: `color-mix(in srgb, ${tone[item.kind]} 45%, transparent)` }}
          >
            <span style={{ color: tone[item.kind] }}>
              <Icon name={glyph[item.kind]} size={17} />
            </span>
            <span className="flex-1">{item.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ── small bits ───────────────────────────────────────────────────────────── */

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      role="progressbar"
      aria-label="loading"
      className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent align-middle"
      style={{ width: size, height: size }}
    />
  );
}

export function EmptyState({ icon = 'spark', title, body, action }: { icon?: IconName; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="card card-pad flex animate-fade-up flex-col items-center gap-3 border-dashed py-10 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-ink-800 text-txt-low">
        <Icon name={icon} size={20} />
      </span>
      <p className="text-sm font-semibold">{title}</p>
      {body ? <p className="max-w-sm text-xs muted">{body}</p> : null}
      {action}
    </div>
  );
}

const STATUS_TONE: Record<WebsiteStatus, { color: string; key: DictKey }> = {
  active: { color: 'var(--ok)', key: 'status_active' },
  in_development: { color: 'var(--accent)', key: 'status_in_development' },
  paused: { color: 'var(--warn)', key: 'status_paused' },
  archived: { color: 'var(--txt-low)', key: 'status_archived' },
};

export function StatusBadge({ status }: { status: WebsiteStatus }) {
  const { t } = useLocale();
  const tone = STATUS_TONE[status];
  return (
    <span
      className="chip"
      style={{ color: tone.color, borderColor: `color-mix(in srgb, ${tone.color} 38%, transparent)`, background: `color-mix(in srgb, ${tone.color} 10%, transparent)` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone.color }} />
      {t(tone.key)}
    </span>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="label">
        {label}
        {required ? <span className="text-bad"> *</span> : null}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-bad">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs faint">{hint}</span>
      ) : null}
    </label>
  );
}

/* ── modal ────────────────────────────────────────────────────────────────── */

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const { t } = useLocale();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/65 p-4 backdrop-blur-sm sm:items-center">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`card relative my-auto w-full animate-pop-in bg-ink-900 shadow-pop ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
      >
        <div className="flex items-center justify-between gap-4 border-b px-5 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" className="btn btn-ghost btn-sm !px-2" onClick={onClose} aria-label={t('close')}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-4">{footer}</div> : null}
      </div>
    </div>
  );
}

/* ── confirm dialog ───────────────────────────────────────────────────────── */

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  requireText,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  /** When set, the confirm button stays dead until the user types this word. */
  requireText?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState('');
  const { t } = useLocale();
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  const ready = !requireText || typed.trim() === requireText;
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={busy || !ready}>
            {busy ? <Spinner /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-bad" style={{ background: 'color-mix(in srgb, var(--bad) 14%, transparent)' }}>
            <Icon name="alert" size={18} />
          </span>
          <p className="text-sm muted">{body}</p>
        </div>
        {requireText ? (
          <Field label={t('type_delete_to_confirm')}>
            <input className="field font-mono tracking-widest" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}
