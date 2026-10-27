import { assertEnv } from '@/lib/env';
import { audit, ERRORS, fail, guard, json, rejectCrossSite } from '@/lib/api';
import { deleteCredential, NotFound, updateCredential } from '@/lib/db';
import { parse, credentialUpdate } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  assertEnv();
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;
  const auth = await guard();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const parsed = parse(credentialUpdate, await req.json().catch(() => null));
  if (!parsed.ok) return fail(ERRORS.VALIDATION, 'Check the credential details.', 400, { issues: parsed.issues });

  try {
    const credential = await updateCredential(auth.profile.id, id, parsed.value);
    await audit(auth.profile.id, 'credential.update', { entityType: 'credential', entityId: id, detail: { password_rotated: !!parsed.value.password } });
    return json({ credential });
  } catch (error) {
    if (error instanceof NotFound) return fail(ERRORS.NOT_FOUND, 'Credential not found.', 404);
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
    await deleteCredential(auth.profile.id, id);
    await audit(auth.profile.id, 'credential.delete', { entityType: 'credential', entityId: id });
    return json({ ok: true });
  } catch (error) {
    if (error instanceof NotFound) return fail(ERRORS.NOT_FOUND, 'Credential not found.', 404);
    return fail(ERRORS.SERVER, error instanceof Error ? error.message : 'Delete failed.', 500);
  }
}
