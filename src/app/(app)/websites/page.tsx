import { PageHead } from '@/components/bits';
import { SiteBrowser } from '@/components/site-browser';
import { requireProfile, uiPrefs } from '@/lib/auth';
import { allCategories, allTags, listRooms, listWebsites } from '@/lib/db';
import { translate, type DictKey } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

type Ctx = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const first = (value: string | string[] | undefined): string => (Array.isArray(value) ? value[0] ?? '' : value ?? '');

export default async function WebsitesPage({ searchParams }: Ctx) {
  const profile = await requireProfile();
  const { locale } = await uiPrefs(profile);
  const t = (key: DictKey, vars?: Record<string, string | number>) => translate(locale, key, vars);
  const params = await searchParams;

  const q = first(params.q);
  const roomId = first(params.room);
  const tag = first(params.tag);

  const [sites, rooms, categories, tags] = await Promise.all([
    listWebsites(profile.id, { includeArchived: true, limit: 500 }),
    listRooms(profile.id, { includeArchived: true }),
    allCategories(profile.id),
    allTags(profile.id),
  ]);

  return (
    <>
      <PageHead title={t('nav_all_sites')} subtitle={t('results_for', { n: sites.length })} />
      <SiteBrowser
        sites={sites}
        rooms={rooms}
        categories={categories}
        tags={tags}
        initialQuery={q}
        initialRoom={roomId}
        initialTag={tag}
        autoOpenNew={first(params.new) === '1'}
      />
    </>
  );
}
