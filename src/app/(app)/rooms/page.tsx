import { PageHead } from '@/components/bits';
import { RoomCard } from '@/components/room-card';
import { RoomCreateButton } from '@/components/room-form';
import { EmptyState } from '@/components/ui';
import { requireProfile, uiPrefs } from '@/lib/auth';
import { listRooms } from '@/lib/db';
import { translate, type DictKey } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function RoomsPage() {
  const profile = await requireProfile();
  const { locale } = await uiPrefs(profile);
  const t = (key: DictKey, vars?: Record<string, string | number>) => translate(locale, key, vars);

  const rooms = await listRooms(profile.id, { includeArchived: true });
  const live = rooms.filter(room => !room.archived);
  const archived = rooms.filter(room => room.archived);

  return (
    <>
      <PageHead title={t('nav_rooms')} subtitle={t('app_tagline')} actions={<RoomCreateButton />} />

      {rooms.length === 0 ? (
        <EmptyState icon="folder" title={t('empty_rooms')} body={t('add_first_room')} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {live.map(room => (
            <RoomCard key={room.id} room={room} />
          ))}
        </div>
      )}

      {archived.length ? (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold muted">{t('archived')}</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {archived.map(room => (
              <RoomCard key={room.id} room={room} />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
