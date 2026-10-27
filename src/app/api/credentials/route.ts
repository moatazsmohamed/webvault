import { assertEnv } from '@/lib/env';
import { audit, ERRORS, fail, guard, json, rejectCrossSite } from '@/lib/api';
import { createCredential, listAllCredentials, NotFound } from '@/lib/db';
import { parse, credentialCreate } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Vault listing: hints and timestamps only. No ciphertext, no plaintext. */
export async function GET() {
  assertEnv();
  const auth = await guard();
  if (!auth.ok) return auth.response;
  return json({ credentials: await listAllCredentials(auth.profile.id), vault_unlocked: auth.unlocked });
}

export async function POST(req: Request) {
  assertEnv();
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;
  const auth = await guard();
  if (!auth.ok) return auth.response;

  const parsed = parse(credentialCreate, await req.json().catch(() => null));
  if (!parsed.ok) return fail(ERRORS.VALIDATION, 'Check the credential details.', 400, { issues: parsed.issues });

  try {
    const credential = await createCredential(auth.profile.id, parsed.value);
    await audit(auth.profile.id, 'credential.create', {
      entityType: 'credential',
      entityId: credential.id,
      detail: { website: credential.website_id, account_type: credential.account_type },
    });
    return json({ credential }, { status: 201 });
  } catch (error) {
    if (error instanceof NotFound) return fail(ERRORS.NOT_FOUND, 'That website does not exist.', 404);
    return fail(ERRORS.SERVER, error instanceof Error ? error.message : 'Create failed.', 500);
  }
}
