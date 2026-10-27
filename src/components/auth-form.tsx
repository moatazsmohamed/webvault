'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from './icons';
import { Field, LocaleProvider, Spinner, useLocale } from './ui';
import { ApiError, api } from '@/lib/client-api';
import type { Locale } from '@/lib/types';

export function AuthForm({ mode }: { mode: 'login' | 'setup' }) {
  const { t } = useLocale();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [setupKey, setSetupKey] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (mode === 'login') {
        await api.post('/api/auth/login', { username, password });
      } else {
        await api.put('/api/auth/login', {
          username,
          password,
          display_name: displayName,
          setup_key: setupKey,
          locale: document.documentElement.lang === 'en' ? 'en' : 'ar',
        });
      }
      router.replace('/');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'THROTTLED') setError(t('err_locked_for', { s: err.retryAfter || 60 }));
        else if (err.code === 'VALIDATION_FAILED' && err.issues.length) setError(`${t('err_validation')} — ${err.issues[0]}`);
        else if (err.status === 403) setError(err.message.includes('Setup key') ? t('err_setup_key') : t('err_setup_closed'));
        else if (err.status === 401) setError(mode === 'login' ? t('err_bad_credentials') : t('err_weak_password'));
        else setError(t('err_server'));
      } else {
        setError(t('err_server'));
      }
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label={t('username')} required>
        <input
          className="field"
          value={username}
          onChange={e => setUsername(e.target.value)}
          autoComplete="username"
          spellCheck={false}
          required
          minLength={3}
          maxLength={80}
        />
      </Field>

      <Field label={t('password')} required hint={mode === 'setup' ? t('err_weak_password') : undefined}>
        <div className="relative">
          <input
            className="field pe-11"
            type={showPass ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            maxLength={512}
          />
          <button
            type="button"
            className="absolute inset-y-0 grid w-10 place-items-center text-txt-low transition hover:text-txt-hi ltr:right-0 rtl:left-0"
            onClick={() => setShowPass(v => !v)}
            aria-label={showPass ? t('hide') : t('reveal')}
          >
            <Icon name={showPass ? 'eyeOff' : 'eye'} size={17} />
          </button>
        </div>
      </Field>

      {mode === 'setup' ? (
        <>
          <Field label={t('display_name')} hint={t('optional')}>
            <input className="field" value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={80} />
          </Field>
          <Field label={t('setup_key')} hint={t('optional')}>
            <input className="field" type="password" value={setupKey} onChange={e => setSetupKey(e.target.value)} autoComplete="off" maxLength={200} />
          </Field>
        </>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm"
          style={{ color: 'var(--bad)', borderColor: 'color-mix(in srgb, var(--bad) 40%, transparent)', background: 'color-mix(in srgb, var(--bad) 9%, transparent)' }}
        >
          <Icon name="alert" size={16} />
          <span>{error}</span>
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary w-full py-2.5" disabled={busy}>
        {busy ? <Spinner /> : <Icon name={mode === 'login' ? 'logout' : 'shield'} size={17} />}
        {mode === 'login' ? (busy ? t('signing_in') : t('sign_in')) : t('create_account')}
      </button>

      <p className="flex items-start justify-center gap-2 text-center text-xs faint">
        <Icon name="lock" size={13} />
        <span>{t('note_hashed')}</span>
      </p>
    </form>
  );
}

function PublicLocaleToggle({ locale }: { locale: Locale }) {
  const next: Locale = locale === 'ar' ? 'en' : 'ar';
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={() => {
        document.cookie = `wv_locale=${next}; path=/; max-age=31536000; SameSite=Lax`;
        location.reload();
      }}
    >
      <Icon name="globe" size={15} />
      {next === 'ar' ? 'عربي' : 'English'}
    </button>
  );
}

export function AuthShell({ locale, mode, children }: { locale: Locale; mode: 'login' | 'setup'; children: ReactNode }) {
  return (
    <LocaleProvider locale={locale}>
      <main className="flex min-h-dvh items-center justify-center px-4 py-10">
        <div className="w-full max-w-md animate-fade-up">
          <div className="mb-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-2xl text-white" style={{ background: 'linear-gradient(135deg, var(--accent-strong), var(--violet))' }}>
                <Icon name="vault" size={20} />
              </span>
              <AuthHeadlines mode={mode} />
            </div>
            <PublicLocaleToggle locale={locale} />
          </div>
          <div className="card card-pad p-5 sm:p-6">{children}</div>
        </div>
      </main>
    </LocaleProvider>
  );
}

function AuthHeadlines({ mode }: { mode: 'login' | 'setup' }) {
  const { t } = useLocale();
  return (
    <div>
      <p className="text-sm font-semibold leading-tight">{t('app_name')}</p>
      <p className="text-xs faint">{mode === 'setup' ? t('first_run_title') : t('app_tagline')}</p>
    </div>
  );
}

export function AuthTitle({ mode }: { mode: 'login' | 'setup' }) {
  const { t } = useLocale();
  return (
    <div className="mb-5 flex flex-col gap-1.5">
      <h1 className="text-xl font-semibold">{mode === 'login' ? t('login_title') : t('first_run_title')}</h1>
      <p className="text-sm muted">{mode === 'login' ? t('login_subtitle') : t('first_run_body')}</p>
    </div>
  );
}
