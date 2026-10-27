import { cookies } from 'next/headers';
import { admin } from '@/lib/supabase/server';
import { assertEnv } from '@/lib/env';
import { audit, clientIp, ERRORS, fail, json, rejectCrossSite } from '@/lib/api';
import { verifyPassword } from '@/lib/crypto';
import { currentProfile, issueUnlockToken, UNLOCK_COOKIE, UNLOCK_SECONDS } from '@/lib/auth';
import { parse, unlockInput } from '@/lib/validation';

export const runtime = 'nodejs';

/**
 * Re-authentication for the vault. The password is checked against a scrypt
 * verifier stored on the profile — it is never forwarded, logged, or returned.
 */
export async function POST(req: Request) {
  assertEnv();
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;

  const profile = await currentProfile();
  if (!profile) return fail(ERRORS.UNAUTHENTICATED, 'Sign in required.', 401);

  const parsed = parse(unlockInput, await req.json().catch(() => null));
  if (!parsed.ok) return fail(ERRORS.VALIDATION, 'Provide your password.', 400);

  const ip = await clientIp(req);
  const key = `unlock:${profile.id}`;
  const { data: state } = await admin().rpc('auth_attempt_state', { p_key: key });
  const lockedUntil = (state as { locked_until: string | null } | null)?.locked_until;
  if (lockedUntil && new Date(lockedUntil).getTime() > Date.now()) {
    return fail(ERRORS.THROTTLED, 'Too many attempts.', 429, {
      retry_after: Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 1000),
    });
  }

  const ok = verifyPassword(parsed.value.password, profile.reveal_salt, profile.reveal_hash);
  if (!ok) {
    await admin().rpc('auth_take_attempt', { p_key: key, p_max_attempts: 5, p_lock_seconds: 300 });
    await audit(profile.id, 'unlock_failed', { entityType: 'vault', ip });
    return fail(ERRORS.UNAUTHENTICATED, 'Password does not match.', 401);
  }

  await admin().rpc('auth_clear_attempt', { p_key: key });
  const token = await issueUnlockToken(profile.id);
  const store = await cookies();
  store.set({
    name: UNLOCK_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'strict',
    secure: true,
    path: '/',
    maxAge: UNLOCK_SECONDS,
  });
  await audit(profile.id, 'vault_unlock', { entityType: 'vault', ip });

  return json({ ok: true, unlocked_for: UNLOCK_SECONDS });
}

export async function DELETE(req: Request) {
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;
  const store = await cookies();
  store.delete(UNLOCK_COOKIE);
  return json({ ok: true });
}
