'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client-api';
import { hostOf, relativeTime } from '@/lib/format';
import { Icon, type IconName } from './icons';
import { StatusBadge, useLocale, useToast } from './ui';
import type { DictKey } from '@/lib/i18n';
import type { UrlKind, WebsiteCard, WebsiteStatus } from '@/lib/types';
import { STATUSES, URL_KINDS } from '@/lib/types';

const KIND_META: Record<UrlKind, { icon: IconName; slotKey: DictKey; actionKey: DictKey }> = {
  live: { icon: 'globe', slotKey: 'url_live', actionKey: 'open_site' },
  admin: { icon: 'grid', slotKey: 'url_admin', actionKey: 'open_admin' },
  developer: { icon: 'settings', slotKey: 'url_developer', actionKey: 'open_developer' },
  source: { icon: 'code', slotKey: 'url_source', actionKey: 'open_source' },
  hosting: { icon: 'server', slotKey: 'url_hosting', actionKey: 'open_hosting' },
};

export const URL_ORDER = URL_KINDS;

/** Opens in a new tab and records the click so "recently accessed" is real usage. */
export function OpenLink({
  siteId,
  kind,
  url,
  variant = 'chip',
  showHost = false,
}: {
  siteId: string;
  kind: UrlKind;
  url: string;
  variant?: 'chip' | 'row';
  showHost?: boolean;
}) {
  const { t } = useLocale();
  const meta = KIND_META[kind];

  async function open() {
    window.open(url, '_blank', 'noopener,noreferrer');
    await api.post(`/api/websites/${siteId}/access`, { kind }).catch(() => null);
  }

  const className =
    variant === 'row'
      ? 'btn btn-ghost w-full justify-between py-2.5 text-start'
      : 'btn btn-ghost btn-sm gap-1.5';

  return (
    <button type="button" onClick={open} className={className} title={hostOf(url)}>
      <span className="flex items-center gap-1.5 truncate">
        <Icon name={meta.icon} size={15} />
        <span className="truncate">{t(meta.actionKey)}</span>
      </span>
      {variant === 'row' ? (
        <span className="flex items-center gap-1.5 text-xs faint">
          {showHost ? hostOf(url) : ''}
          <Icon name="external" size={13} />
        </span>
      ) : (
        <Icon name="external" size={12} />
      )}
    </button>
  );
}

export function WebsiteCardView({ site, showRoom = true }: { site: WebsiteCard; showRoom?: boolean }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const kinds = URL_ORDER.filter(kind => site.urls[kind]);

  return (
    <article className="card card-pad flex animate-fade-up flex-col gap-3 transition hover:-translate-y-0.5 hover:shadow-pop">
      <div className="flex items-start gap-3">
        <span className="mt-1 h-9 w-1.5 shrink-0 rounded-full" style={{ background: site.room_color }} />
        <div className="min-w-0 flex-1">
          <Link href={`/websites/${site.id}`} className="block truncate text-sm font-semibold hover:underline underline-offset-4">
            {site.name}
          </Link>
          <p className="mt-0.5 truncate text-xs faint">
            {showRoom ? site.room_name : ''}
            {site.client_name ? ` · ${site.client_name}` : ''}
            {site.category ? ` · ${site.category}` : ''}
          </p>
        </div>
        <StatusBadge status={site.status} />
      </div>

      {site.description ? <p className="line-clamp-2 text-xs muted">{site.description}</p> : null}

      {site.tags.length ? (
        <div className="flex flex-wrap gap-1.5">
          {site.tags.slice(0, 4).map(tag => (
            <button key={tag} type="button" className="chip bg-ink-800 hover:bg-ink-700" onClick={() => router.push(`/websites?tag=${encodeURIComponent(tag)}`)}>
              #{tag}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-auto flex flex-wrap gap-1.5 border-t pt-3">
        {kinds.length
          ? kinds.map(kind => <OpenLink key={kind} siteId={site.id} kind={kind} url={site.urls[kind] as string} />)
          : <span className="text-xs faint">{t('no_links')}</span>}
      </div>

      <div className="flex items-center justify-between gap-2 text-[11px] faint">
        <span className="flex items-center gap-1.5">
          <Icon name="clock" size={12} />
          {site.last_accessed_at ? relativeTime(site.last_accessed_at, locale) : relativeTime(site.created_at, locale)}
        </span>
        <span className="flex items-center gap-1.5">
          <Icon name="key" size={12} />
          {site.credential_count}
        </span>
      </div>
    </article>
  );
}

/** Changes status in place — archive/restore is a status, not a separate screen. */
export function StatusPicker({ siteId, status }: { siteId: string; status: WebsiteStatus }) {
  const { t } = useLocale();
  const toast = useToast();
  const router = useRouter();

  return (
    <select
      className="field !w-auto !py-2 text-xs"
      value={status}
      onChange={async e => {
        const next = e.target.value as WebsiteStatus;
        try {
          await api.patch(`/api/websites/${siteId}`, { status: next });
          toast.push('ok', t('updated_ok'));
          router.refresh();
        } catch (err) {
          toast.push('bad', err instanceof Error ? err.message : t('err_server'));
        }
      }}
      aria-label={t('status')}
    >
      {STATUSES.map(value => (
        <option key={value} value={value}>
          {t(`status_${value}` as DictKey)}
        </option>
      ))}
    </select>
  );
}
