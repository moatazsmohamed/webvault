import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Callout, PageHead, Panel } from '@/components/bits';
import { Icon } from '@/components/icons';
import { OpenLink, StatusPicker } from '@/components/website-card';
import { WebsiteDeleteButton, WebsiteEditButton } from '@/components/website-form';
import { CredentialAddButton, CredentialRow, LockButton, UnlockButton } from '@/components/vault';
import { EmptyState } from '@/components/ui';
import { isVaultUnlocked, requireProfile, uiPrefs } from '@/lib/auth';
import { getWebsite, listRooms, allCategories } from '@/lib/db';
import { formatDateTime, hostOf } from '@/lib/format';
import { translate, type DictKey } from '@/lib/i18n';
import { URL_KINDS, type UrlKind } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const SLOT_KEY: Record<UrlKind, DictKey> = {
  live: 'url_live',
  admin: 'url_admin',
  developer: 'url_developer',
  source: 'url_source',
  hosting: 'url_hosting',
};

export default async function WebsitePage({ params }: Ctx) {
  const profile = await requireProfile();
  const { locale } = await uiPrefs(profile);
  const t = (key: DictKey, vars?: Record<string, string | number>) => translate(locale, key, vars);
  const { id } = await params;

  const site = await getWebsite(profile.id, id);
  if (!site) notFound();

  const [rooms, categories, unlocked] = await Promise.all([
    listRooms(profile.id, { includeArchived: true }),
    allCategories(profile.id),
    isVaultUnlocked(profile.id),
  ]);

  const missing = !site.description.trim() || !site.category.trim() || URL_KINDS.every(kind => !site.urls[kind]);

  return (
    <>
      <div className="mb-3">
        <Link href={`/rooms/${site.room_id}`} className="link-quiet inline-flex items-center gap-1.5 text-xs">
          <span className="h-2 w-2 rounded-full" style={{ background: site.room_color }} />
          {site.room_name}
        </Link>
      </div>

      <PageHead
        title={site.name}
        subtitle={site.description || t('optional')}
        actions={
          <>
            <StatusPicker siteId={site.id} status={site.status} />
            {unlocked ? <LockButton /> : <UnlockButton />}
            <WebsiteEditButton site={site} rooms={rooms} categories={categories} />
            <WebsiteDeleteButton siteId={site.id} siteName={site.name} />
          </>
        }
      />

      {missing ? (
        <div className="mb-4">
          <Callout tone="warn">
            <span className="text-xs">{t('attention_body')}</span>
          </Callout>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <div className="flex flex-col gap-4">
          <Panel title={t('links')} icon="globe">
            <div className="flex flex-col gap-2.5">
              {URL_KINDS.map(kind => {
                const url = site.urls[kind];
                return (
                  <div key={kind} className="flex flex-col gap-1.5">
                    <p className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-wide faint">
                      <span>{t(SLOT_KEY[kind])}</span>
                      <span>{url ? hostOf(url) : t('slot_empty')}</span>
                    </p>
                    {url ? (
                      <OpenLink siteId={site.id} kind={kind} url={url} variant="row" showHost />
                    ) : (
                      <div className="btn btn-ghost pointer-events-none w-full justify-start opacity-50">
                        <Icon name="plus" size={15} />
                        {t('edit')}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Panel>

          {site.thumbnail_url ? (
            <Panel title={t('thumbnail')} icon="spark">
              <img src={site.thumbnail_url} alt="" className="w-full rounded-xl border object-cover" loading="lazy" />
            </Panel>
          ) : null}

          {site.notes ? (
            <Panel title={t('notes')} icon="edit">
              <p className="whitespace-pre-wrap text-sm muted">{site.notes}</p>
            </Panel>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <Panel title={t('site_name')} icon="grid">
            <dl className="grid grid-cols-2 gap-y-3 text-xs">
              <dt className="faint">{t('status')}</dt>
              <dd>{t(`status_${site.status}` as DictKey)}</dd>
              <dt className="faint">{t('category')}</dt>
              <dd>{site.category || '—'}</dd>
              <dt className="faint">{t('client')}</dt>
              <dd>{site.client_name || '—'}</dd>
              <dt className="faint">{t('added_on')}</dt>
              <dd>{formatDateTime(site.created_at, locale)}</dd>
              <dt className="faint">{t('recently_accessed')}</dt>
              <dd>{site.last_accessed_at ? formatDateTime(site.last_accessed_at, locale) : '—'}</dd>
              <dt className="faint">{t('recently_accessed')} #</dt>
              <dd>{site.access_count}</dd>
            </dl>
            {site.tags.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-3">
                {site.tags.map(tag => (
                  <Link key={tag} href={`/websites?tag=${encodeURIComponent(tag)}`} className="chip bg-ink-800">
                    #{tag}
                  </Link>
                ))}
              </div>
            ) : null}
          </Panel>

          <Panel
            title={t('credentials_for')}
            icon="key"
            action={<CredentialAddButton fixedWebsiteId={site.id} sites={[{ id: site.id, name: site.name }]} />}
          >
            {!unlocked ? (
              <div className="mb-3">
                <Callout icon="lock">
                  <span className="text-xs">{t('reveal_after_unlock')}</span>
                </Callout>
              </div>
            ) : null}
            {site.credentials.length === 0 ? (
              <EmptyState icon="key" title={t('add_credential')} body={t('optional')} />
            ) : (
              <div className="flex flex-col gap-3">
                {site.credentials.map(credential => (
                  <CredentialRow key={credential.id} meta={credential} unlocked={unlocked} />
                ))}
              </div>
            )}
            <p className="mt-3 text-[11px] faint">{t('reveal_limit_note')}</p>
          </Panel>
        </div>
      </div>
    </>
  );
}
