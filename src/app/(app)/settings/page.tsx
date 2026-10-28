import { Callout, PageHead, Panel } from '@/components/bits';
import { Icon } from '@/components/icons';
import { ExportButtons, PasswordChangeForm, ProfileForm, RecoveryEmailForm, SecurityNotes, UsernameChangeForm } from '@/components/settings-panels';
import { LockButton, UnlockButton } from '@/components/vault';
import { EmptyState } from '@/components/ui';
import { activityFeed, dashboardStats } from '@/lib/db';
import { isVaultUnlocked, requireProfile, uiPrefs } from '@/lib/auth';
import { formatDateTime, relativeTime } from '@/lib/format';
import { activityLabel, translate, type DictKey } from '@/lib/i18n';
import { mailEnabled, maskEmail } from '@/lib/mail';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const profile = await requireProfile();
  const { locale } = await uiPrefs(profile);
  const t = (key: DictKey, vars?: Record<string, string | number>) => translate(locale, key, vars);

  const [activity, stats, unlocked] = await Promise.all([
    activityFeed(profile.id, 24),
    dashboardStats(profile.id),
    isVaultUnlocked(profile.id),
  ]);

  return (
    <>
      <PageHead
        title={t('settings')}
        subtitle={`@${profile.username} · ${t('total_sites')}: ${stats.websites} · ${t('total_credentials')}: ${stats.credentials}`}
        actions={unlocked ? <LockButton /> : <UnlockButton />}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={t('profile_info')} icon="settings">
          <ProfileForm displayName={profile.display_name} locale={locale} theme={profile.theme} />
        </Panel>

        <Panel title={t('security')} icon="shield">
          <div className="flex flex-col gap-5">
            <PasswordChangeForm />
            <div className="border-t pt-4">
              <h3 className="label">{t('change_username')}</h3>
              <UsernameChangeForm username={profile.username} />
            </div>
          </div>
        </Panel>

        <Panel title={t('recovery_panel')} icon="mail">
          <div className="flex flex-col gap-5">
            <RecoveryEmailForm masked={maskEmail(profile.recovery_email)} configured={!!profile.recovery_email} />
            {!mailEnabled() ? (
              <div className="border-t pt-4">
                <Callout icon="alert">
                  <p className="text-xs">{t('recovery_transport_off')}</p>
                </Callout>
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel title={t('security_preferences')} icon="lock">
          <div className="flex flex-col gap-4">
            <SecurityNotes />
            <Callout icon="key">
              <p className="text-xs">{t('vault_auto_lock', { s: 300 })}</p>
            </Callout>
          </div>
        </Panel>

        <Panel title={t('export')} icon="download">
          <ExportButtons />
        </Panel>
      </div>

      <Panel title={t('activity_log')} icon="clock" className="mt-4">
        {activity.length === 0 ? (
          <EmptyState icon="clock" title={t('activity_empty')} />
        ) : (
          <ul className="flex flex-col divide-y">
            {activity.map(entry => (
              <li key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-xs">
                <span className="flex min-w-40 items-center gap-2 font-medium">
                  <Icon name="spark" size={13} />
                  {activityLabel(locale, entry.action)}
                </span>
                <span className="faint">{formatDateTime(entry.created_at, locale)}</span>
                <span className="ms-auto faint">{relativeTime(entry.created_at, locale)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
