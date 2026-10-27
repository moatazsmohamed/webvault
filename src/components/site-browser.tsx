'use client';

import { useEffect, useMemo, useState } from 'react';
import { Icon } from './icons';
import { EmptyState, useLocale } from './ui';
import { WebsiteCardView } from './website-card';
import { WebsiteCreateButton } from './website-form';
import type { DictKey } from '@/lib/i18n';
import type { Room, WebsiteCard, WebsiteStatus } from '@/lib/types';
import { STATUSES } from '@/lib/types';

export function SiteBrowser({
  sites,
  rooms,
  categories,
  tags,
  initialQuery = '',
  initialRoom = '',
  initialTag = '',
  defaultRoomId,
  lockRoom = false,
  autoOpenNew = false,
}: {
  sites: WebsiteCard[];
  rooms: Room[];
  categories: string[];
  tags: string[];
  initialQuery?: string;
  initialRoom?: string;
  initialTag?: string;
  defaultRoomId?: string;
  lockRoom?: boolean;
  autoOpenNew?: boolean;
}) {
  const { t } = useLocale();
  const [query, setQuery] = useState(initialQuery);
  const [roomId, setRoomId] = useState(initialRoom);
  const [status, setStatus] = useState<WebsiteStatus | ''>('');
  const [category, setCategory] = useState('');
  const [tag, setTag] = useState(initialTag);

  useEffect(() => {
    setQuery(initialQuery);
    setRoomId(initialRoom);
    setTag(initialTag);
  }, [initialQuery, initialRoom, initialTag]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sites.filter(site => {
      if (roomId && site.room_id !== roomId) return false;
      if (status && site.status !== status) return false;
      if (category && site.category !== category) return false;
      if (tag && !site.tags.includes(tag)) return false;
      if (!needle) return true;
      const haystack = [
        site.name,
        site.description,
        site.category,
        site.client_name,
        site.room_name,
        ...site.tags,
        ...Object.values(site.urls),
      ]
        .join(' ')
        .toLowerCase();
      return needle.split(/\s+/).every(word => haystack.includes(word));
    });
  }, [sites, query, roomId, status, category, tag]);

  const dirty = Boolean(query.trim() || roomId || status || category || tag);

  return (
    <div className="flex flex-col gap-4">
      <div className="card flex flex-col gap-3 p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <span className="pointer-events-none absolute inset-y-0 grid w-9 place-items-center text-txt-low ltr:left-0 rtl:right-0">
              <Icon name="search" size={15} />
            </span>
            <input
              className="field ps-9"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('search_placeholder')}
              aria-label={t('nav_search')}
              maxLength={200}
            />
          </div>
          <WebsiteCreateButton rooms={rooms} categories={categories} defaultRoomId={defaultRoomId} autoOpen={autoOpenNew} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-[11px] faint">
            <Icon name="spark" size={13} />
            {t('filters')}
          </span>
          {!lockRoom ? (
            <select className="field !w-auto !py-1.5 text-xs" value={roomId} onChange={e => setRoomId(e.target.value)} aria-label={t('filter_room')}>
              <option value="">{t('all_rooms')}</option>
              {rooms.map(room => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
          ) : null}
          <select className="field !w-auto !py-1.5 text-xs" value={status} onChange={e => setStatus(e.target.value as WebsiteStatus | '')} aria-label={t('filter_status')}>
            <option value="">{t('status')}</option>
            {STATUSES.map(value => (
              <option key={value} value={value}>
                {t(`status_${value}` as DictKey)}
              </option>
            ))}
          </select>
          {categories.length ? (
            <select className="field !w-auto !py-1.5 text-xs" value={category} onChange={e => setCategory(e.target.value)} aria-label={t('filter_category')}>
              <option value="">{t('category')}</option>
              {categories.map(value => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          ) : null}
          {tags.length ? (
            <select className="field !w-auto !py-1.5 text-xs" value={tag} onChange={e => setTag(e.target.value)} aria-label={t('filter_tag')}>
              <option value="">{t('tags')}</option>
              {tags.map(value => (
                <option key={value} value={value}>
                  #{value}
                </option>
              ))}
            </select>
          ) : null}
          {dirty ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setQuery('');
                setRoomId('');
                setStatus('');
                setCategory('');
                setTag('');
              }}
            >
              <Icon name="x" size={14} />
              {t('clear_filters')}
            </button>
          ) : null}
          <span className="chip ms-auto bg-ink-850 text-xs">
            <Icon name="globe" size={12} />
            {t('results_for', { n: filtered.length })}
          </span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={dirty ? 'search' : 'globe'}
          title={dirty ? t('empty_search') : t('empty_sites')}
          body={dirty ? t('clear_filters') : undefined}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map(site => (
            <WebsiteCardView key={site.id} site={site} showRoom={!lockRoom} />
          ))}
        </div>
      )}
    </div>
  );
}
