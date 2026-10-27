'use client';

import { useMemo, useState } from 'react';
import { Icon } from './icons';
import { CredentialAddButton, CredentialRow } from './vault';
import { EmptyState, useLocale } from './ui';
import type { DictKey } from '@/lib/i18n';
import type { AccountType, CredentialMeta } from '@/lib/types';
import { ACCOUNT_TYPES } from '@/lib/types';

export function VaultBrowser({
  credentials,
  unlocked,
  sites,
}: {
  credentials: (CredentialMeta & { website_name: string; room_name: string })[];
  unlocked: boolean;
  sites: { id: string; name: string }[];
}) {
  const { t } = useLocale();
  const [query, setQuery] = useState('');
  const [type, setType] = useState<AccountType | ''>('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return credentials.filter(item => {
      if (type && item.account_type !== type) return false;
      if (!needle) return true;
      const haystack = [item.title, item.website_name, item.room_name, item.username_hint, item.login_url ?? '', t(`type_${item.account_type}` as DictKey)]
        .join(' ')
        .toLowerCase();
      return needle.split(/\s+/).every(word => haystack.includes(word));
    });
  }, [credentials, query, type, t]);

  const counts = useMemo(() => {
    const map = new Map<AccountType, number>();
    for (const item of credentials) map.set(item.account_type, (map.get(item.account_type) ?? 0) + 1);
    return map;
  }, [credentials]);

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
          <CredentialAddButton sites={sites} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="chip"
            style={type === '' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : { color: 'var(--txt-low)' }}
            onClick={() => setType('')}
          >
            {t('filter_status')}: {credentials.length}
          </button>
          {ACCOUNT_TYPES.map(value => (
            <button
              key={value}
              type="button"
              className="chip"
              style={type === value ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : { color: 'var(--txt-mid)' }}
              onClick={() => setType(type === value ? '' : value)}
            >
              {t(`type_${value}` as DictKey)}
              <span className="faint">{counts.get(value) ?? 0}</span>
            </button>
          ))}
          <span className="chip ms-auto bg-ink-850 text-xs">
            <Icon name="key" size={12} />
            {t('results_for', { n: filtered.length })}
          </span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon="key"
          title={credentials.length ? t('empty_search') : t('nav_vault')}
          body={credentials.length ? t('clear_filters') : t('empty_sites')}
        />
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {filtered.map(item => (
            <CredentialRow key={item.id} meta={item} unlocked={unlocked} showSite />
          ))}
        </div>
      )}
    </div>
  );
}
