'use client';

import Link from 'next/link';
import { Icon, type IconName } from './icons';
import { RoomArchiveButton, RoomDeleteButton, RoomEditButton } from './room-form';
import { useLocale } from './ui';
import { formatDate } from '@/lib/format';
import type { Room } from '@/lib/types';

export function RoomCard({ room, showActions = true }: { room: Room; showActions?: boolean }) {
  const { t, locale } = useLocale();
  return (
    <article
      className="card card-pad flex flex-col gap-3 animate-fade-up transition hover:-translate-y-0.5 hover:shadow-pop"
      style={{ borderColor: `color-mix(in srgb, ${room.color} 30%, var(--line))` }}
    >
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl" style={{ background: `color-mix(in srgb, ${room.color} 16%, transparent)`, color: room.color }}>
          <Icon name={room.icon as IconName} size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <Link href={`/rooms/${room.id}`} className="block truncate text-sm font-semibold hover:underline underline-offset-4">
            {room.name}
          </Link>
          <p className="mt-0.5 line-clamp-2 text-xs muted">{room.description || t('optional')}</p>
        </div>
        {room.archived ? (
          <span className="chip !py-0.5" style={{ color: 'var(--txt-low)' }}>
            <Icon name="vault" size={12} />
            {t('archived')}
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label={t('nav_all_sites')} value={room.website_count} tone="var(--accent)" />
        <Stat label={t('total_dashboards')} value={room.dashboard_count} tone="var(--violet)" />
        <Stat label={t('attention')} value={room.incomplete_count} tone={room.incomplete_count ? 'var(--warn)' : 'var(--ok)'} />
      </div>

      <div className="flex items-center justify-between gap-2 border-t pt-3">
        <span className="text-[11px] faint">
          {formatDate(room.created_at, locale)} · {t('sites_count', { n: room.website_count })}
        </span>
        {showActions ? (
          <span className="flex items-center gap-1.5">
            <RoomEditButton room={room} />
            <RoomArchiveButton room={room} />
            <RoomDeleteButton room={room} />
          </span>
        ) : null}
      </div>
    </article>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl bg-ink-850/70 px-2 py-2.5">
      <p className="text-base font-semibold leading-none" style={{ color: tone }}>
        {value}
      </p>
      <p className="mt-1 truncate text-[10px] faint">{label}</p>
    </div>
  );
}

export function RoomTile({ room }: { room: Room }) {
  const { t } = useLocale();
  return (
    <Link
      href={`/rooms/${room.id}`}
      className="card flex items-center gap-3 px-3.5 py-3 transition hover:-translate-y-0.5 hover:shadow-pop"
      style={{ borderColor: `color-mix(in srgb, ${room.color} 28%, var(--line))` }}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: `color-mix(in srgb, ${room.color} 16%, transparent)`, color: room.color }}>
        <Icon name={room.icon as IconName} size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{room.name}</span>
        <span className="block text-[11px] faint">{t('sites_count', { n: room.website_count })}</span>
      </span>
      <Icon name="globe" size={14} />
    </Link>
  );
}
