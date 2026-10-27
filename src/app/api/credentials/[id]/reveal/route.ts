import { admin } from '@/lib/supabase/server';
import { assertEnv } from '@/lib/env';
import { audit, ERRORS, fail, guard, json, rejectCrossSite } from '@/lib/api';
import { revealCredential } from '@/lib/db';
import { VaultError } from '@/lib/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const REVEAL_MAX = 20;
const REVEAL_WINDOW = 10 * 60;

/**
 * The only endpoint that returns a plaintext secret. It requires:
 *   1. a verified session,
 *   2. a vault-unlock token issued by a fresh password check (≤5 min old),
 *   3. same-origin, and
 *   4. a rate limit so bulk exfiltration of the vault is not quiet.
 */
export async function POST(req: Request, { params }: Ctx) {
  assertEnv();
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;

  const auth = await guard();
  if (!auth.ok) return auth.response;
  if (!auth.unlocked) return fail(ERRORS.VAULT_LOCKED, 'Unlock the vault first.', 423);

  const { id } = await params;
  const key = `reveal:${auth.profile.id}`;
  const outcome = await admin().rpc('auth_take_attempt', {
    p_key: key,
    p_max_attempts: REVEAL_MAX,
    p_window_seconds: REVEAL_WINDOW,
    p_lock_seconds: REVEAL_WINDOW,
  });
  const state = outcome.data as { allowed: boolean; retry_after_seconds: number } | null;
  if (state && state.allowed === false) {
    return fail(ERRORS.THROTTLED, 'Too many reveals. Wait a moment.', 429, { retry_after: state.retry_after_seconds });
  }

  try {
    const revealed = await revealCredential(auth.profile.id, id);
    if (!revealed) return fail(ERRORS.NOT_FOUND, 'Credential not found.', 404);
    await audit(auth.profile.id, 'credential.reveal', { entityType: 'credential', entityId: id, detail: { website: revealed.website_id } });
    return json({ credential: revealed }, { headers: { 'cache-control': 'no-store, max-age=0' } });
  } catch (error) {
    if (error instanceof VaultError) return fail(ERRORS.VAULT_DECRYPT_FAILED, 'This record could not be decrypted with the current key.', 500);
    return fail(ERRORS.SERVER, 'Reveal failed.', 500);
  }
}
