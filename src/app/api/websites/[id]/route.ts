import { assertEnv } from '@/lib/env';
import { audit, ERRORS, fail, guard, json, rejectCrossSite } from '@/lib/api';
import { deleteWebsite, getWebsite, NotFound, updateWebsite } from '@/lib/db';
import { parse, websiteUpdate } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Detail view. Safe by construction: `getWebsite` returns link URLs and
 * credential *metadata* only — no username, no password, no ciphertext.
 */
export async function GET(_req: Request, { params }: Ctx) {
  assertEnv();
  const auth = await guard();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const website = await getWebsite(auth.profile.id, id);
  if (!website) return fail(ERRORS.NOT_FOUND, 'Website not found.', 404);
  return json({ website, vault_unlocked: auth.unlocked });
}

export async function PATCH(req: Request, { params }: Ctx) {
  assertEnv();
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;
  const auth = await guard();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const parsed = parse(websiteUpdate, await req.json().catch(() => null));
  if (!parsed.ok) return fail(ERRORS.VALIDATION, 'Check the website details.', 400, { issues: parsed.issues });

  try {
    const website = await updateWebsite(auth.profile.id, id, parsed.value);
    await audit(auth.profile.id, 'website.update', { entityType: 'website', entityId: id });
    return json({ website });
  } catch (error) {
    if (error instanceof NotFound) return fail(ERRORS.NOT_FOUND, 'Website or room not found.', 404);
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

  if (req.headers.get('x-confirm-delete') !== 'DELETE') {
    return fail(ERRORS.VALIDATION, 'Type DELETE to confirm this destructive action.', 400);
  }
  try {
    await deleteWebsite(auth.profile.id, id);
    await audit(auth.profile.id, 'website.delete', { entityType: 'website', entityId: id });
    return json({ ok: true });
  } catch (error) {
    if (error instanceof NotFound) return fail(ERRORS.NOT_FOUND, 'Website not found.', 404);
    return fail(ERRORS.SERVER, error instanceof Error ? error.message : 'Delete failed.', 500);
  }
}
