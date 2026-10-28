'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from './icons';
import { Field, Spinner, useLocale } from './ui';
import { ApiError, api } from '@/lib/client-api';

const RESEND_COOLDOWN = 60;

/**
 * Two-step recovery: ask for a code on the stored address, then spend it on a new
 * password. The code is never put in a URL and the server never echoes it back.
 */
export function ResetForm({ initialUsername }: { initialUsername: string }) {
  const { t } = useLocale();
  const router = useRouter();
  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [username, setUsername] = useState(initialUsername);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function sendCode() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/api/auth/forgot', { username });
      setStep('verify');
      setCooldown(RESEND_COOLDOWN);
    } catch (err) {
      setError(requestError(err));
    } finally {
      setBusy(false);
    }
  }

  function request(e: FormEvent) {
    e.preventDefault();
    void sendCode();
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (password.length < 12) {
      setError(t('err_weak_password'));
      return;
    }
    if (password !== confirm) {
      setError(t('err_password_match'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post('/api/auth/reset', { username, code, password });
      router.replace('/');
      router.refresh();
    } catch (err) {
      setError(requestError(err));
      setBusy(false);
    }
  }

  function requestError(err: unknown): string {
    if (!(err instanceof ApiError)) return t('err_server');
    if (err.code === 'THROTTLED') return t('err_locked_for', { s: err.retryAfter || 60 });
    if (err.code === 'VALIDATION_FAILED' && err.issues.length) return `${t('err_validation')} — ${err.issues[0]}`;
    if (err.code === 'UNAUTHENTICATED') return t('err_bad_code');
    if (err.status === 503) return t('err_mail_disabled');
    return t('err_server');
  }

  if (step === 'request') {
    return (
      <form onSubmit={request} className="flex flex-col gap-4">
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

        <p className="flex items-start gap-2 text-xs faint">
          <Icon name="mail" size={14} />
          <span>{t('reset_step1_hint')}</span>
        </p>

        {error ? <ErrorLine text={error} /> : null}

        <button type="submit" className="btn btn-primary w-full py-2.5" disabled={busy}>
          {busy ? <Spinner /> : <Icon name="key" size={17} />}
          {t('send_code')}
        </button>

        <a href="/login" className="btn btn-ghost w-full">
          <Icon name="logout" size={15} />
          {t('back_to_login')}
        </a>
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="flex flex-col gap-4">
      <p className="flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs" style={{ borderColor: 'color-mix(in srgb, var(--accent) 35%, transparent)' }}>
        <Icon name="mail" size={15} />
        <span>{t('reset_step2_hint', { username: username.toLowerCase() })}</span>
      </p>

      <Field label={t('code')} required hint={t('code_hint')}>
        <input
          className="field font-mono tracking-[0.4em] text-center"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          required
          minLength={6}
          maxLength={6}
        />
      </Field>

      <Field label={t('new_password')} required hint={t('err_weak_password')}>
        <input className="field" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" required minLength={12} maxLength={512} />
      </Field>

      <Field label={t('confirm_password')} required error={error}>
        <input className="field" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" required maxLength={512} />
      </Field>

      <button type="submit" className="btn btn-primary w-full py-2.5" disabled={busy}>
        {busy ? <Spinner /> : <Icon name="shield" size={17} />}
        {t('set_new_password')}
      </button>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={cooldown > 0 || busy}
          onClick={() => void sendCode()}
        >
          <Icon name="key" size={14} />
          {cooldown > 0 ? t('resend_in', { s: cooldown }) : t('resend_code')}
        </button>
        <a href="/login" className="text-xs faint underline">{t('back_to_login')}</a>
      </div>
    </form>
  );
}

function ErrorLine({ text }: { text: string }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm"
      style={{ color: 'var(--bad)', borderColor: 'color-mix(in srgb, var(--bad) 40%, transparent)', background: 'color-mix(in srgb, var(--bad) 9%, transparent)' }}
    >
      <Icon name="alert" size={16} />
      <span>{text}</span>
    </p>
  );
}
