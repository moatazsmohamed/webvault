'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Icon, type IconName } from './icons';
import { LocaleProvider, ToastProvider, useLocale, useToast } from './ui';
import { api } from '@/lib/client-api';
import type { DictKey } from '@/lib/i18n';
import type { Locale } from '@/lib/types';

type NavItem = { href: string; key: DictKey; icon: IconName };

const NAV: NavItem[] = [
  { href: '/dashboard', key: 'nav_overview', icon: 'grid' },
  { href: '/rooms', key: 'nav_rooms', icon: 'folder' },
  { href: '/websites', key: 'nav_all_sites', icon: 'globe' },
  { href: '/vault', key: 'nav_vault', icon: 'key' },
  { href: '/settings', key: 'nav_settings', icon: 'settings' },
];

export type ShellProps = {
  locale: Locale;
  theme: 'dark' | 'light';
  username: string;
  displayName: string;
  vaultUnlocked: boolean;
  children: ReactNode;
};

export function AppShell(props: ShellProps) {
  return (
    <LocaleProvider locale={props.locale}>
      <ToastProvider>
        <Shell {...props} />
      </ToastProvider>
    </LocaleProvider>
  );
}

function Shell({ locale, theme, username, displayName, vaultUnlocked, children }: ShellProps) {
  const { t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [unlocked, setUnlocked] = useState(vaultUnlocked);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => setUnlocked(vaultUnlocked), [vaultUnlocked]);

  async function signOut() {
    await api.post('/api/auth/logout').catch(() => null);
    toast.push('ok', t('sign_out_done'));
    router.replace('/login');
    router.refresh();
  }

  async function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.cookie = `wv_theme=${next}; path=/; max-age=31536000; SameSite=Lax`;
    try {
      await api.patch('/api/settings', { display_name: displayName, locale, theme: next });
    } catch {
      /* cookie already set; the next render picks it up */
    }
    router.refresh();
  }

  function toggleLocale() {
    const next: Locale = locale === 'ar' ? 'en' : 'ar';
    document.cookie = `wv_locale=${next}; path=/; max-age=31536000; SameSite=Lax`;
    try {
      void api.patch('/api/settings', { display_name: displayName, locale: next, theme });
    } catch {
      /* ignore */
    }
    router.refresh();
  }

  const navLinks = NAV.map(item => {
    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
          active ? 'bg-accent-soft font-semibold text-txt-hi' : 'muted hover:bg-ink-800 hover:text-txt-hi'
        }`}
        style={active ? { boxShadow: 'inset 2px 0 0 0 var(--accent)' } : undefined}
      >
        <Icon name={item.icon} size={17} />
        <span className="flex-1">{t(item.key)}</span>
        {active ? <span className="h-1.5 w-1.5 rounded-full bg-accent" /> : null}
      </Link>
    );
  });

  const sidebar = (
    <div className="flex h-full flex-col gap-5 p-4">
      <Link href="/dashboard" className="flex items-center gap-3 px-1">
        <span className="grid h-9 w-9 place-items-center rounded-xl text-white" style={{ background: 'linear-gradient(135deg, var(--accent-strong), var(--violet))' }}>
          <Icon name="vault" size={18} />
        </span>
        <span>
          <span className="block text-sm font-semibold leading-tight">{t('app_name')}</span>
          <span className="block text-[11px] faint">{t('app_tagline')}</span>
        </span>
      </Link>

      <form
        onSubmit={e => {
          e.preventDefault();
          router.push(q.trim() ? `/websites?q=${encodeURIComponent(q.trim())}` : '/websites');
        }}
        className="relative"
      >
        <span className="pointer-events-none absolute inset-y-0 grid w-9 place-items-center text-txt-low ltr:left-0 rtl:right-0">
          <Icon name="search" size={15} />
        </span>
        <input
          className="field ps-9 text-sm"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={t('search_placeholder')}
          aria-label={t('nav_search')}
          maxLength={200}
        />
      </form>

      <nav className="flex flex-col gap-1">{navLinks}</nav>

      <Link href="/websites?new=1" className="btn btn-primary w-full">
        <Icon name="plus" size={16} />
        {t('nav_add_site')}
      </Link>

      <div className="mt-auto flex flex-col gap-3">
        <div className="card card-pad !p-3">
          <button
            type="button"
            className="flex w-full items-center gap-2.5 text-start"
            onClick={() => router.push('/settings')}
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink-800 text-xs font-bold" style={{ color: 'var(--violet)' }}>
              {(displayName || username).slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold">{displayName || username}</span>
              <span className="block truncate text-[11px] faint">@{username}</span>
            </span>
          </button>
          <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
            <span className="chip !py-0.5" style={unlocked ? { color: 'var(--ok)', borderColor: 'color-mix(in srgb, var(--ok) 40%, transparent)' } : { color: 'var(--txt-low)' }}>
              <Icon name={unlocked ? 'unlock' : 'lock'} size={12} />
              {unlocked ? t('vault_open') : t('vault_locked')}
            </span>
            <span className="flex gap-1">
              <button type="button" className="btn btn-ghost btn-sm !px-2" onClick={toggleTheme} aria-label={t('theme_toggle')}>
                <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
              </button>
              <button type="button" className="btn btn-ghost btn-sm !px-2 font-semibold" onClick={toggleLocale} aria-label={t('language')}>
                {locale === 'ar' ? 'EN' : 'ع'}
              </button>
            </span>
          </div>
        </div>

        <button type="button" onClick={signOut} className="btn btn-ghost w-full">
          <Icon name="logout" size={16} />
          {t('nav_logout')}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[19rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh border-e bg-ink-900/70 backdrop-blur lg:block">{sidebar}</aside>

      {open ? (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 w-[17.5rem] animate-pop-in border-e bg-ink-900 ltr:left-0 rtl:right-0">{sidebar}</div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-40 flex items-center gap-3 border-b bg-ink-950/85 px-4 py-3 backdrop-blur lg:hidden">
          <button type="button" className="btn btn-ghost btn-sm !px-2" onClick={() => setOpen(true)} aria-label={t('menu')}>
            <Icon name="menu" size={18} />
          </button>
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Icon name="vault" size={16} />
            {t('app_name')}
          </span>
          <Link href="/websites?new=1" className="btn btn-primary btn-sm ms-auto">
            <Icon name="plus" size={15} />
            {t('nav_add_site')}
          </Link>
        </header>

        <main className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
