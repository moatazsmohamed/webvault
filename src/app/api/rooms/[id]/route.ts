import { assertEnv } from '@/lib/env';
import { audit, ERRORS, fail, guard, json, rejectCrossSite } from '@/lib/api';
import { deleteRoom, getRoom, NotFound, updateRoom } from '@/lib/db';
import { parse, roomUpdate } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  assertEnv();
  const auth = await guard();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const room = await getRoom(auth.profile.id, id);
  if (!room) return fail(ERRORS.NOT_FOUND, 'Room not found.', 404);
  return json({ room });
}

export async function PATCH(req: Request, { params }: Ctx) {
  assertEnv();
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;
  const auth = await guard();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const parsed = parse(roomUpdate, await req.json().catch(() => null));
  if (!parsed.ok) return fail(ERRORS.VALIDATION, 'Check the room details.', 400, { issues: parsed.issues });

  try {
    const room = await updateRoom(auth.profile.id, id, parsed.value);
    await audit(auth.profile.id, 'room.update', { entityType: 'room', entityId: id });
    return json({ room });
  } catch (error) {
    if (error instanceof NotFound) return fail(ERRORS.NOT_FOUND, 'Room not found.', 404);
    return fail(ERRORS.SERVER, error instanceof Error ? error.message : 'Update failed.', 500);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  assertEnv();
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;
  const auth = await guard();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  // Deleting a room cascades to every website and credential inside it.
  const confirm = req.headers.get('x-confirm-delete');
  if (confirm !== 'DELETE') return fail(ERRORS.VALIDATION, 'Type DELETE to confirm this destructive action.', 400);

  try {
    await deleteRoom(auth.profile.id, id);
    await audit(auth.profile.id, 'room.delete', { entityType: 'room', entityId: id });
    return json({ ok: true });
  } catch (error) {
    if (error instanceof NotFound) return fail(ERRORS.NOT_FOUND, 'Room not found.', 404);
    return fail(ERRORS.SERVER, error instanceof Error ? error.message : 'Delete failed.', 500);
  }
}
