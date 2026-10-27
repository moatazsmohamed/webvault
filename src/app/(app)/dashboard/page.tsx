import Link from 'next/link';
import { Callout, InlineLink, PageHead, Panel, StatCard } from '@/components/bits';
import { Icon } from '@/components/icons';
import { RoomCard, RoomTile } from '@/components/room-card';
import { RoomCreateButton } from '@/components/room-form';
import { WebsiteCardView } from '@/components/website-card';
import { WebsiteCreateButton } from '@/components/website-form';
import { LockButton, UnlockButton } from '@/components/vault';
import { isVaultUnlocked, requireProfile, uiPrefs } from '@/lib/auth';
import {
  activityFeed,
  allCategories,
  dashboardStats,
  incompleteWebsites,
  listRooms,
  recentWebsites,
  recentlyAccessed,
} from '@/lib/db';
import { hostOf, relativeTime } from '@/lib/format';
import { activityLabel, translate, type DictKey } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const profile = await requireProfile();
  const { locale } = await uiPrefs(profile);
  const t = (key: DictKey, vars?: Record<string, string | number>) => translate(locale, key, vars);
  const owner = profile.id;

  const [stats, rooms, recent, accessed, incomplete, categories, activity, unlocked] = await Promise.all([
    dashboardStats(owner),
    listRooms(owner),
    recentWebsites(owner, 6),
    recentlyAccessed(owner, 5),
    incompleteWebsites(owner, 6),
    allCategories(owner),
    activityFeed(owner, 8),
    isVaultUnlocked(owner),
  ]);

  return (
    <>
      <PageHead
        title={t('dashboard_for', { name: profile.display_name || profile.username })}
        subtitle={t('dashboard_subtitle')}
        actions={
          <>
            {unlocked ? <LockButton /> : <UnlockButton />}
            <WebsiteCreateButton rooms={rooms} categories={categories} />
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('total_rooms')} value={stats.rooms} icon="folder" tone="var(--violet)" />
        <StatCard label={t('total_sites')} value={stats.websites} icon="globe" tone="var(--accent)" hint={`${stats.active} ${t('status_active')}`} />
        <StatCard label={t('total_dashboards')} value={stats.dashboards} icon="grid" tone="var(--ok)" />
        <StatCard label={t('total_credentials')} value={stats.credentials} icon="key" tone={unlocked ? 'var(--warn)' : 'var(--txt-mid)'} hint={unlocked ? t('vault_open') : t('vault_locked')} />
      </div>

      {incomplete.length > 0 ? (
        <div className="mt-4">
          <Callout tone="warn">
            <p className="font-semibold">
              {t('attention')} · {t('incomplete_count', { n: stats.incomplete })}
            </p>
            <p className="mt-0.5 text-xs muted">{t('attention_body')}</p>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {incomplete.map(site => (
                <Link key={site.id} href={`/websites/${site.id}`} className="text-xs underline-offset-4 hover:underline" style={{ color: 'var(--warn)' }}>
                  {site.name}
                </Link>
              ))}
            </div>
          </Callout>
        </div>
      ) : stats.websites > 0 ? (
        <div className="mt-4">
          <Callout tone="ok" icon="check">
            {t('all_healthy')}
          </Callout>
        </div>
      ) : null}

      <div className="mt-6 flex flex-col gap-4">
        <Panel
          title={t('nav_rooms')}
          icon="folder"
          action={<RoomCreateButton label={t('new_room')} />}
        >
          {rooms.length === 0 ? (
            <p className="py-4 text-center text-sm muted">{t('empty_rooms')}</p>
          ) : (
            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {rooms.map(room => (
                <RoomTile key={room.id} room={room} />
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <Panel title={t('recently_added')} icon="spark" action={<InlineLink href="/websites">{t('nav_all_sites')}</InlineLink>}>
          {recent.length === 0 ? (
            <p className="py-6 text-center text-sm muted">{t('empty_sites')}</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {recent.map(site => (
                <WebsiteCardView key={site.id} site={site} />
              ))}
            </div>
          )}
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel title={t('recently_accessed')} icon="clock">
            {accessed.length === 0 ? (
              <p className="py-4 text-center text-sm muted">{t('empty_search')}</p>
            ) : (
              <ul className="flex flex-col divide-y">
                {accessed.map(site => (
                  <li key={site.id}>
                    <Link href={`/websites/${site.id}`} className="flex items-center gap-3 py-2.5 transition hover:ps-1">
                      <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: site.room_color }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{site.name}</span>
                        <span className="block truncate text-[11px] faint">
                          {hostOf(site.urls.live) || site.room_name} · {relativeTime(site.last_accessed_at, locale)}
                        </span>
                      </span>
                      <Icon name="external" size={13} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={t('activity_log')} icon="shield" action={<InlineLink href="/settings">{t('settings')}</InlineLink>}>
            {activity.length === 0 ? (
              <p className="py-4 text-center text-sm muted">{t('activity_empty')}</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {activity.map(entry => (
                  <li key={entry.id} className="flex items-start gap-2.5 text-xs">
                    <span className="mt-0.5 shrink-0 text-txt-low">
                      <Icon name="clock" size={13} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate muted">{activityLabel(locale, entry.action)}</span>
                      <span className="block text-[11px] faint">{relativeTime(entry.created_at, locale)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {rooms.length > 0 ? (
        <div className="mt-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Icon name="grid" size={16} />
            {t('quick_actions')}
          </h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rooms.slice(0, 3).map(room => (
              <RoomCard key={room.id} room={room} showActions={false} />
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
