'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Icon, type IconName } from './icons';
import { Field, Spinner, useLocale, useToast } from './ui';
import { ApiError, api } from '@/lib/client-api';
import type { Locale } from '@/lib/types';

export function ProfileForm({ displayName, locale, theme }: { displayName: string; locale: Locale; theme: 'dark' | 'light' }) {
  const { t } = useLocale();
  const toast = useToast();
  const router = useRouter();
  const [draft, setDraft] = useState({ displayName, locale, theme });
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch('/api/settings', { display_name: draft.displayName, locale: draft.locale, theme: draft.theme });
      document.cookie = `wv_locale=${draft.locale}; path=/; max-age=31536000; SameSite=Lax`;
      document.cookie = `wv_theme=${draft.theme}; path=/; max-age=31536000; SameSite=Lax`;
      toast.push('ok', t('updated_ok'));
      router.refresh();
    } catch (err) {
      toast.push('bad', err instanceof ApiError ? err.message : t('err_server'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label={t('display_name')}>
        <input className="field" value={draft.displayName} onChange={e => setDraft(d => ({ ...d, displayName: e.target.value }))} maxLength={80} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('language')}>
          <div className="flex gap-2">
            {(['ar', 'en'] as Locale[]).map(value => (
              <button
                key={value}
                type="button"
                className="btn btn-ghost flex-1"
                style={draft.locale === value ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
                onClick={() => setDraft(d => ({ ...d, locale: value }))}
              >
                <Icon name="globe" size={15} />
                {value === 'ar' ? 'العربية (RTL)' : 'English (LTR)'}
              </button>
            ))}
          </div>
        </Field>

        <Field label={t('theme')}>
          <div className="flex gap-2">
            {(['dark', 'light'] as const).map(value => (
              <button
                key={value}
                type="button"
                className="btn btn-ghost flex-1"
                style={draft.theme === value ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
                onClick={() => setDraft(d => ({ ...d, theme: value }))}
              >
                <Icon name={value === 'dark' ? 'moon' : 'sun'} size={15} />
                {value === 'dark' ? t('dark') : t('light')}
              </button>
            ))}
          </div>
        </Field>
      </div>

      <button type="submit" className="btn btn-primary self-end" disabled={busy}>
        {busy ? <Spinner /> : <Icon name="check" size={16} />}
        {t('save')}
      </button>
    </form>
  );
}

export function PasswordChangeForm() {
  const { t } = useLocale();
  const toast = useToast();
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next.length < 12) {
      setError(t('err_weak_password'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post('/api/settings/account', { action: 'password', current_password: current, new_password: next });
      setCurrent('');
      setNext('');
      toast.push('ok', t('updated_ok'));
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? t('err_bad_credentials') : t('err_server'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label={t('current_password')} required>
        <input className="field" type="password" value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" required maxLength={512} />
      </Field>
      <Field label={t('new_password')} required hint={t('err_weak_password')} error={error}>
        <input className="field" type="password" value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" required minLength={12} maxLength={512} />
      </Field>
      <p className="text-[11px] faint">{t('unlock_body')}</p>
      <button type="submit" className="btn btn-primary self-end" disabled={busy}>
        {busy ? <Spinner /> : <Icon name="shield" size={16} />}
        {t('change_password')}
      </button>
    </form>
  );
}

export function UsernameChangeForm({ username }: { username: string }) {
  const { t } = useLocale();
  const toast = useToast();
  const router = useRouter();
  const [value, setValue] = useState(username);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (value === username) {
      setValue('');
      setPassword('');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post('/api/settings/account', { action: 'username', username: value, password });
      setPassword('');
      toast.push('ok', t('updated_ok'));
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('err_server'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label={t('username')} required hint="3–40 · a-z 0-9 . _ -">
        <input className="field" value={value} onChange={e => setValue(e.target.value)} spellCheck={false} required maxLength={40} />
      </Field>
      <Field label={t('current_password')} required error={error}>
        <input className="field" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required maxLength={512} />
      </Field>
      <button type="submit" className="btn btn-ghost self-end" disabled={busy}>
        {busy ? <Spinner /> : <Icon name="edit" size={16} />}
        {t('change_username')}
      </button>
    </form>
  );
}

export function ExportButtons() {
  const { t } = useLocale();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs muted">{t('export_note')}</p>
      <div className="flex flex-wrap gap-2">
        <a className="btn btn-ghost btn-sm" href="/api/export?format=json" download>
          <Icon name="download" size={15} />
          {t('export_json')}
        </a>
        <a className="btn btn-ghost btn-sm" href="/api/export?format=csv" download>
          <Icon name="download" size={15} />
          {t('export_csv')}
        </a>
      </div>
      <p className="text-[11px] faint">{t('export_safe_note')}</p>
    </div>
  );
}

export function SecurityNotes() {
  const { t } = useLocale();
  const items: { icon: IconName; text: string }[] = [
    { icon: 'lock', text: t('security_note') },
    { icon: 'shield', text: t('never_show_in_url') },
    { icon: 'key', text: t('reveal_limit_note') },
    { icon: 'eyeOff', text: t('vault_auto_lock', { s: 300 }) },
  ];
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map(item => (
        <li key={item.text} className="flex items-start gap-2.5 text-xs muted">
          <span className="mt-0.5 shrink-0 text-ok">
            <Icon name={item.icon} size={14} />
          </span>
          <span>{item.text}</span>
        </li>
      ))}
    </ul>
  );
}
