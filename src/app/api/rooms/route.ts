import { assertEnv } from '@/lib/env';
import { audit, ERRORS, fail, guard, json, rejectCrossSite } from '@/lib/api';
import { createRoom, listRooms } from '@/lib/db';
import { parse, roomCreate } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  assertEnv();
  const auth = await guard();
  if (!auth.ok) return auth.response;
  return json({ rooms: await listRooms(auth.profile.id, { includeArchived: true }) });
}

export async function POST(req: Request) {
  assertEnv();
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;
  const auth = await guard();
  if (!auth.ok) return auth.response;

  const parsed = parse(roomCreate, await req.json().catch(() => null));
  if (!parsed.ok) return fail(ERRORS.VALIDATION, 'Check the room details.', 400, { issues: parsed.issues });

  try {
    const room = await createRoom(auth.profile.id, {
      name: parsed.value.name,
      slug: parsed.value.slug,
      description: parsed.value.description,
      color: parsed.value.color,
      icon: parsed.value.icon,
    });
    await audit(auth.profile.id, 'room.create', { entityType: 'room', entityId: room.id });
    return json({ room }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('duplicate key')) return fail(ERRORS.CONFLICT, 'A room with that name already exists.', 409);
    if (message) return fail(ERRORS.SERVER, message, 500);
    throw error;
  }
}

