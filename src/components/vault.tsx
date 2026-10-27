'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icon } from './icons';
import { ConfirmDialog, Field, Modal, Spinner, useLocale, useToast } from './ui';
import { ApiError, api, copyText } from '@/lib/client-api';
import { hostOf, relativeTime } from '@/lib/format';
import type { DictKey } from '@/lib/i18n';
import type { AccountType, CredentialMeta, RevealedCredential } from '@/lib/types';
import { ACCOUNT_TYPES } from '@/lib/types';

const TYPE_KEYS: Record<AccountType, DictKey> = { admin: 'type_admin', developer: 'type_developer', client: 'type_client', other: 'type_other' };
const TYPE_TONE: Record<AccountType, string> = { admin: 'var(--violet)', developer: 'var(--accent)', client: 'var(--ok)', other: 'var(--txt-low)' };
const AUTO_MASK_MS = 60_000;

/* ── unlock ─────────────────────────────────────────────────────────────────── */

export function UnlockDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLocale();
  const toast = useToast();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setPassword('');
      setError('');
    }
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.post<{ unlocked_for: number }>('/api/auth/unlock', { password });
      toast.push('ok', t('unlocked_ok'));
      onClose();
      router.refresh();
      window.setTimeout(() => {
        toast.push('info', t('locked_ok'));
        router.refresh();
      }, res.unlocked_for * 1000);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'THROTTLED') setError(t('err_locked_for', { s: err.retryAfter || 300 }));
      else setError(err instanceof ApiError && err.status === 401 ? t('err_bad_credentials') : t('err_server'));
      setPassword('');
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title={t('unlock_title')} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex gap-3 rounded-xl border bg-ink-850/70 p-3">
          <span className="shrink-0 text-violet">
            <Icon name="shield" size={18} />
          </span>
          <p className="text-xs muted">{t('unlock_body')}</p>
        </div>

        <Field label={t('type_password_to_reveal')} required>
          <input className="field" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required autoFocus maxLength={512} />
        </Field>
        <p className="text-[11px] faint">{t('never_show_in_url')}</p>

        {error ? <p className="text-sm text-bad">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <Spinner /> : <Icon name="unlock" size={16} />}
            {t('unlock')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function UnlockButton({ variant = 'btn' }: { variant?: 'btn' | 'sm' }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={variant === 'sm' ? 'btn btn-primary btn-sm' : 'btn btn-primary'} onClick={() => setOpen(true)}>
        <Icon name="unlock" size={16} />
        {t('unlock')}
      </button>
      <UnlockDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function LockButton() {
  const { t } = useLocale();
  const toast = useToast();
  const router = useRouter();

  async function lock() {
    await api.del('/api/auth/unlock').catch(() => null);
    toast.push('info', t('locked_ok'));
    router.refresh();
  }
  return (
    <button type="button" className="btn btn-ghost btn-sm" onClick={lock}>
      <Icon name="lock" size={15} />
      {t('vault_locked')}
    </button>
  );
}

/* ── credential row ────────────────────────────────────────────────────────── */

export function CredentialRow({ meta, unlocked, showSite }: { meta: CredentialMeta; unlocked: boolean; showSite?: boolean }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const router = useRouter();
  const [revealed, setRevealed] = useState<RevealedCredential | null>(null);
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const maskTimer = useRef<number | null>(null);

  const clearMask = useCallback(() => {
    if (maskTimer.current) window.clearTimeout(maskTimer.current);
    maskTimer.current = null;
    setRevealed(null);
  }, []);

  useEffect(() => () => clearMask(), [clearMask]);
  useEffect(() => {
    if (!unlocked && revealed) clearMask();
  }, [unlocked, revealed, clearMask]);

  async function reveal() {
    if (!unlocked) {
      setUnlockOpen(true);
      return;
    }
    if (revealed) {
      clearMask();
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ credential: RevealedCredential }>(`/api/credentials/${meta.id}/reveal`, {});
      setRevealed(res.credential);
      maskTimer.current = window.setTimeout(() => {
        setRevealed(null);
        toast.push('info', t('hide'));
      }, AUTO_MASK_MS);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VAULT_LOCKED') setUnlockOpen(true);
      else toast.push('bad', err instanceof ApiError ? err.message : t('err_server'));
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string, label: string) {
    const ok = await copyText(value);
    toast.push(ok ? 'ok' : 'bad', ok ? `${label}: ${t('copied')}` : t('err_server'));
  }

  return (
    <div className="card card-pad flex flex-col gap-3 animate-fade-up">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: `color-mix(in srgb, ${TYPE_TONE[meta.account_type]} 16%, transparent)`, color: TYPE_TONE[meta.account_type] }}>
          <Icon name="key" size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{meta.title || t(TYPE_KEYS[meta.account_type])}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs faint">
            <span className="chip !py-0.5" style={{ color: TYPE_TONE[meta.account_type], borderColor: `color-mix(in srgb, ${TYPE_TONE[meta.account_type]} 40%, transparent)` }}>
              {t(TYPE_KEYS[meta.account_type])}
            </span>
            {showSite ? (
              <Link href={`/websites/${meta.website_id}`} className="link-quiet">
                {meta.website_name ?? ''}
                {meta.room_name ? ` · ${meta.room_name}` : ''}
              </Link>
            ) : null}
            {meta.login_url ? <span className="font-mono">{hostOf(meta.login_url)}</span> : null}
          </p>
        </div>
        <span className="text-[11px] faint">
          {meta.reveal_count === 0 ? t('never_revealed') : t('revealed_times', { n: meta.reveal_count })}
          {meta.last_revealed_at ? ` · ${relativeTime(meta.last_revealed_at, locale)}` : ''}
        </span>
      </div>

      {revealed ? (
        <div className="flex flex-col gap-2 rounded-xl border bg-ink-850/70 p-3">
          <Row label={t('username')} value={revealed.username} onCopy={() => copy(revealed.username, t('username'))} mono />
          <Row label={t('password')} value={revealed.password} onCopy={() => copy(revealed.password, t('password'))} mono />
          {revealed.notes ? <p className="whitespace-pre-wrap text-xs muted">{revealed.notes}</p> : null}
          <p className="text-[11px] faint">{t('vault_auto_lock', { s: Math.floor(AUTO_MASK_MS / 1000) })}</p>
        </div>
      ) : (
        <p className="text-xs muted">
          <span className="font-mono">{meta.username_hint || '••••'}</span>
          <span className="ms-2 faint">{unlocked ? t('reveal') : t('reveal_after_unlock')}</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <button type="button" className="btn btn-ghost btn-sm" onClick={reveal} disabled={busy}>
          {busy ? <Spinner /> : <Icon name={revealed ? 'eyeOff' : 'eye'} size={15} />}
          {revealed ? t('hide') : t('reveal')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditOpen(true)}>
          <Icon name="edit" size={15} />
          {t('edit')}
        </button>
        {meta.login_url ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              window.open(meta.login_url ?? '', '_blank', 'noopener,noreferrer');
              void api.post(`/api/websites/${meta.website_id}/access`, { kind: 'page' }).catch(() => null);
            }}
          >
            <Icon name="external" size={15} />
            {t('open_login_page')}
          </button>
        ) : null}
        <button type="button" className="btn btn-danger btn-sm ms-auto" onClick={() => setDeleteOpen(true)}>
          <Icon name="trash" size={15} />
          {t('delete')}
        </button>
      </div>

      <CredentialFormModal open={editOpen} credential={meta} onClose={() => setEditOpen(false)} />
      <UnlockDialog open={unlockOpen} onClose={() => setUnlockOpen(false)} />
      <ConfirmDialog
        open={deleteOpen}
        title={`${t('delete')} — ${meta.title || t('vault')}`}
        body={t('delete_credential_warning')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        requireText="DELETE"
        onCancel={() => setDeleteOpen(false)}
        onConfirm={async () => {
          try {
            await api.del(`/api/credentials/${meta.id}`, { confirm: true });
            toast.push('ok', t('deleted_ok'));
            setDeleteOpen(false);
            router.refresh();
          } catch (err) {
            toast.push('bad', err instanceof ApiError ? err.message : t('err_server'));
            setDeleteOpen(false);
          }
        }}
      />
    </div>
  );
}

function Row({ label, value, onCopy, mono }: { label: string; value: string; onCopy: () => void; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <span className="me-2 text-[11px] uppercase tracking-wide faint">{label}</span>
        <span className={`break-all text-sm ${mono ? 'font-mono' : ''}`}>{value}</span>
      </div>
      <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={onCopy}>
        <Icon name="copy" size={14} />
      </button>
    </div>
  );
}

/* ── credential form ───────────────────────────────────────────────────────── */

type CredDraft = {
  website_id: string;
  account_type: AccountType;
  title: string;
  login_url: string;
  username: string;
  password: string;
  notes: string;
};

const HTTP_RE = /^https?:\/\/[^\s]+$/i;

export function CredentialFormModal({
  open,
  credential,
  sites,
  fixedWebsiteId,
  onClose,
}: {
  open: boolean;
  credential?: CredentialMeta | null;
  sites?: { id: string; name: string }[];
  fixedWebsiteId?: string;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const toast = useToast();
  const router = useRouter();
  const [draft, setDraft] = useState<CredDraft>({
    website_id: credential?.website_id ?? fixedWebsiteId ?? sites?.[0]?.id ?? '',
    account_type: credential?.account_type ?? 'admin',
    title: credential?.title ?? '',
    login_url: credential?.login_url ?? '',
    username: '',
    password: '',
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft({
      website_id: credential?.website_id ?? fixedWebsiteId ?? sites?.[0]?.id ?? '',
      account_type: credential?.account_type ?? 'admin',
      title: credential?.title ?? '',
      login_url: credential?.login_url ?? '',
      username: '',
      password: '',
      notes: '',
    });
    setErrors({});
  }, [open, credential, fixedWebsiteId, sites]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;

    const next: Record<string, string> = {};
    if (draft.login_url && !HTTP_RE.test(draft.login_url)) next.login_url = t('url_hint');
    if (!credential) {
      if (!draft.username.trim()) next.username = t('required_field');
      if (!draft.password) next.password = t('required_field');
      if (!draft.website_id) next.website_id = t('required_field');
    }
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    try {
      if (credential) {
        const patch: Record<string, unknown> = {
          account_type: draft.account_type,
          title: draft.title.trim(),
          login_url: draft.login_url.trim() || null,
        };
        if (draft.username.trim()) patch.username = draft.username.trim();
        if (draft.password) patch.password = draft.password;
        patch.notes = draft.notes.trim();
        await api.patch(`/api/credentials/${credential.id}`, patch);
        toast.push('ok', t('updated_ok'));
      } else {
        await api.post('/api/credentials', {
          website_id: draft.website_id,
          account_type: draft.account_type,
          title: draft.title.trim(),
          login_url: draft.login_url.trim() || null,
          username: draft.username.trim(),
          password: draft.password,
          notes: draft.notes.trim(),
        });
        toast.push('ok', t('saved_credential_ok'));
      }
      onClose();
      router.refresh();
    } catch (err) {
      toast.push('bad', err instanceof ApiError ? err.message : t('err_server'));
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title={credential ? t('edit_credential') : t('add_credential')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </button>
          <button type="submit" form="cred-form" className="btn btn-primary" disabled={busy}>
            {busy ? <Spinner /> : <Icon name="shield" size={16} />}
            {t('save')}
          </button>
        </>
      }
    >
      <form id="cred-form" onSubmit={submit} className="flex flex-col gap-4">
        {!credential && sites && sites.length > 1 ? (
          <Field label={t('site_name')} required error={errors.website_id}>
            <select className="field" value={draft.website_id} onChange={e => setDraft(d => ({ ...d, website_id: e.target.value }))}>
              {sites.map(site => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('cred_title')} hint={t('optional')}>
            <input className="field" value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} maxLength={80} />
          </Field>
          <Field label={t('account_type')}>
            <select className="field" value={draft.account_type} onChange={e => setDraft(d => ({ ...d, account_type: e.target.value as AccountType }))}>
              {ACCOUNT_TYPES.map(type => (
                <option key={type} value={type}>
                  {t(TYPE_KEYS[type])}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label={t('login_page')} hint={t('optional')} error={errors.login_url}>
          <input className="field" inputMode="url" placeholder={t('url_hint')} value={draft.login_url} onChange={e => setDraft(d => ({ ...d, login_url: e.target.value }))} maxLength={2048} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('username')}
            required={!credential}
            error={errors.username}
            hint={credential ? t('credential_hint_note', { hint: credential.username_hint }) : undefined}
          >
            <input className="field" value={draft.username} onChange={e => setDraft(d => ({ ...d, username: e.target.value }))} autoComplete="off" maxLength={320} />
          </Field>
          <Field label={t('password')} required={!credential} error={errors.password} hint={credential ? t('password_unchanged_hint') : undefined}>
            <input className="field" type="password" value={draft.password} onChange={e => setDraft(d => ({ ...d, password: e.target.value }))} autoComplete="new-password" maxLength={512} />
          </Field>
        </div>

        <Field label={t('notes')} hint={t('optional')}>
          <textarea className="field min-h-16 resize-y" value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} maxLength={1000} />
        </Field>

        <p className="flex items-start gap-2 rounded-xl border bg-ink-850/60 p-3 text-[11px] muted">
          <span className="shrink-0 text-ok">
            <Icon name="lock" size={14} />
          </span>
          <span>{t('never_show_in_url')}</span>
        </p>
      </form>
    </Modal>
  );
}

export function CredentialAddButton({
  sites,
  fixedWebsiteId,
  disabled,
}: {
  sites?: { id: string; name: string }[];
  fixedWebsiteId?: string;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)} disabled={disabled}>
        <Icon name="plus" size={15} />
        {t('add_credential')}
      </button>
      <CredentialFormModal open={open} sites={sites} fixedWebsiteId={fixedWebsiteId} onClose={() => setOpen(false)} />
    </>
  );
}
