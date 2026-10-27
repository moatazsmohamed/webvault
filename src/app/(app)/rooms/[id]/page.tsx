import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon, type IconName } from '@/components/icons';
import { RoomArchiveButton, RoomDeleteButton, RoomEditButton } from '@/components/room-form';
import { SiteBrowser } from '@/components/site-browser';
import { requireProfile, uiPrefs } from '@/lib/auth';
import { allCategories, allTags, getRoom, listRooms, listWebsites } from '@/lib/db';
import { formatDate } from '@/lib/format';
import { translate, type DictKey } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export default async function RoomPage({ params }: Ctx) {
  const profile = await requireProfile();
  const { locale } = await uiPrefs(profile);
  const t = (key: DictKey, vars?: Record<string, string | number>) => translate(locale, key, vars);
  const { id } = await params;

  const room = await getRoom(profile.id, id);
  if (!room) notFound();

  const [sites, rooms, categories, tags] = await Promise.all([
    listWebsites(profile.id, { roomId: room.id, includeArchived: true }),
    listRooms(profile.id, { includeArchived: true }),
    allCategories(profile.id),
    allTags(profile.id),
  ]);

  return (
    <>
      <header className="card card-pad mb-4 flex flex-wrap items-start gap-4" style={{ borderColor: `color-mix(in srgb, ${room.color} 32%, var(--line))` }}>
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl" style={{ background: `color-mix(in srgb, ${room.color} 16%, transparent)`, color: room.color }}>
          <Icon name={room.icon as IconName} size={26} />
        </span>
        <div className="min-w-56 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold">{room.name}</h1>
            {room.archived ? (
              <span className="chip !py-0.5" style={{ color: 'var(--txt-low)' }}>
                {t('archived')}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm muted">{room.description || t('optional')}</p>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] faint">
            <span>{t('sites_count', { n: room.website_count })}</span>
            <span>{t('total_dashboards')}: {room.dashboard_count}</span>
            <span>{t('attention')}: {room.incomplete_count}</span>
            <span>
              {t('added_on')}: {formatDate(room.created_at, locale)}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/rooms" className="btn btn-ghost btn-sm">
            <Icon name="folder" size={15} />
            {t('back_to_rooms')}
          </Link>
          <RoomEditButton room={room} />
          <RoomArchiveButton room={room} />
          <RoomDeleteButton room={room} />
        </div>
      </header>

      <SiteBrowser sites={sites} rooms={rooms} categories={categories} tags={tags} defaultRoomId={room.id} lockRoom />
    </>
  );
}
