import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import './globals.css';
import { LOCALE_COOKIE, THEME_COOKIE } from '@/lib/auth';
import { dirOf } from '@/lib/i18n';
import type { Locale } from '@/lib/types';

export const metadata: Metadata = {
  title: 'WebVault — my websites management system',
  description: 'A private dashboard for every website you build: rooms, links and an encrypted credentials vault.',
  robots: { index: false, follow: false, nocache: true },
  other: { 'X-Robots-Tag': 'noindex, nofollow, noarchive' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#07080c',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'en' ? 'en' : 'ar') as Locale;
  const theme = store.get(THEME_COOKIE)?.value === 'light' ? 'light' : 'dark';

  return (
    <html lang={locale} dir={dirOf(locale)} data-theme={theme} suppressHydrationWarning>
      <body className="bg-ink-950 text-txt-hi antialiased">{children}</body>
    </html>
  );
}
