import { Callout, PageHead } from '@/components/bits';
import { EmptyState } from '@/components/ui';
import { VaultBrowser } from '@/components/vault-browser';
import { LockButton, UnlockButton } from '@/components/vault';
import { isVaultUnlocked, requireProfile, uiPrefs } from '@/lib/auth';
import { listAllCredentials, listRooms, listWebsites } from '@/lib/db';
import { translate, type DictKey } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function VaultPage() {
  const profile = await requireProfile();
  const { locale } = await uiPrefs(profile);
  const t = (key: DictKey, vars?: Record<string, string | number>) => translate(locale, key, vars);

  const [credentials, sites, unlocked] = await Promise.all([
    listAllCredentials(profile.id),
    listWebsites(profile.id, { includeArchived: true, limit: 500 }),
    isVaultUnlocked(profile.id),
  ]);

  if (sites.length === 0) {
    return (
      <>
        <PageHead title={t('nav_vault')} subtitle={t('app_tagline')} />
        <EmptyState icon="key" title={t('empty_sites')} body={t('attention_body')} />
      </>
    );
  }

  return (
    <>
      <PageHead
        title={t('nav_vault')}
        subtitle={t('results_for', { n: credentials.length })}
        actions={unlocked ? <LockButton /> : <UnlockButton variant="btn" />}
      />

      <div className="mb-4">
        <Callout icon={unlocked ? 'unlock' : 'lock'} tone={unlocked ? 'warn' : 'info'}>
          <p className="text-sm font-semibold">{unlocked ? t('vault_open') : t('vault_locked')}</p>
          <p className="mt-0.5 text-xs muted">{unlocked ? t('vault_auto_lock', { s: 300 }) : t('unlock_body')}</p>
        </Callout>
      </div>

      <VaultBrowser
        credentials={credentials}
        unlocked={unlocked}
        sites={sites.map(site => ({ id: site.id, name: `${site.name} — ${site.room_name}` }))}
      />
    </>
  );
}
