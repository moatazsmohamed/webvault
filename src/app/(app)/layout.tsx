import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell';
import { isVaultUnlocked, requireProfile, uiPrefs } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const profile = await requireProfile();
  const { locale, theme } = await uiPrefs(profile);

  return (
    <AppShell
      locale={locale}
      theme={theme}
      username={profile.username}
      displayName={profile.display_name}
      vaultUnlocked={await isVaultUnlocked(profile.id)}
    >
      {children}
    </AppShell>
  );
}
