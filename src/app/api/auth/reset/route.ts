import { cookies } from 'next/headers';
import { admin, authClient, authEmailFor } from '@/lib/supabase/server';
import { assertEnv } from '@/lib/env';
import { audit, clientIp, ERRORS, fail, json, rejectCrossSite } from '@/lib/api';
import { hashCode, makePasswordVerifier } from '@/lib/crypto';
import { UNLOCK_COOKIE } from '@/lib/auth';
import { RECOVERY_MAX_ATTEMPTS } from '@/lib/mail';
import { parse, passwordResetInput } from '@/lib/validation';

export const runtime = 'nodejs';

/**
 * Step 2 of recovery: the code plus a new password. A wrong code, an expired code,
 * a spent code and an unknown username all answer with the same message, and the
 * per-account counter is what stops someone from guessing six digits.
 */
export async function POST(req: Request) {
  assertEnv();
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;

  const parsed = parse(passwordResetInput, await req.json().catch(() => null));
  if (!parsed.ok) return fail(ERRORS.VALIDATION, 'Check the code and the new password.', 400, { issues: parsed.issues });

  const ip = await clientIp(req);
  const { username, code, password } = parsed.value;
  const lower = username.toLowerCase();
  const db = admin();
  const codeKey = `reset:code:user:${lower}`;

  const { data: state } = await db.rpc('auth_attempt_state', { p_key: codeKey });
  const lockedUntil = (state as { locked_until: string | null } | null)?.locked_until;
  if (lockedUntil && new Date(lockedUntil).getTime() > Date.now()) {
    return fail(ERRORS.THROTTLED, 'Too many attempts.', 429, {
      retry_after: Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 1000),
    });
  }

  const { data: profile } = await db.from('profiles').select('id').eq('username', lower).maybeSingle();

  let matched = false;
  if (profile?.id) {
    const { data } = await db.rpc('webvault_consume_reset', {
      p_user: profile.id,
      p_code_hash: hashCode(profile.id, code),
      p_max_attempts: RECOVERY_MAX_ATTEMPTS,
    });
    const outcome = (Array.isArray(data) ? data[0] : data) as { matched?: boolean } | undefined;
    matched = outcome?.matched === true;
  }

  if (!matched) {
    await db.rpc('auth_take_attempt', { p_key: codeKey, p_max_attempts: RECOVERY_MAX_ATTEMPTS, p_window_seconds: 900, p_lock_seconds: 900 });
    await audit(profile?.id ?? null, 'password_reset_denied', {
      entityType: 'auth',
      entityId: lower,
      ip,
      userAgent: req.headers.get('user-agent') ?? '',
    });
    return fail(ERRORS.UNAUTHENTICATED, 'That code is not valid, or it has expired.', 400);
  }

  const { error: authError } = await db.auth.admin.updateUserById(profile!.id, { password });
  if (authError) {
    await audit(profile!.id, 'password_reset_failed', { entityType: 'auth', entityId: lower, ip });
    return fail(ERRORS.SERVER, 'Could not set the new password.', 500);
  }

  // Stored passwords are sealed with WEBVAULT_ENC_KEY, not with the account
  // password, so the vault survives this swap — only the verifier changes.
  const verifier = makePasswordVerifier(password);
  const { error: profileError } = await db
    .from('profiles')
    .update({ reveal_salt: verifier.salt, reveal_hash: verifier.hash })
    .eq('id', profile!.id);
  if (profileError) {
    await audit(profile!.id, 'password_reset_failed', { entityType: 'auth', entityId: lower, ip });
    return fail(ERRORS.SERVER, 'The password changed, but the vault verifier could not be updated. Sign in and change it again from Settings.', 500);
  }

  await Promise.all([
    db.rpc('webvault_complete_reset', { p_user: profile!.id }),
    db.rpc('auth_clear_attempt', { p_key: codeKey }),
    db.rpc('auth_clear_attempt', { p_key: `reset:send:user:${lower}` }),
    db.rpc('auth_clear_attempt', { p_key: `reset:send:ip:${ip}` }),
    audit(profile!.id, 'password.reset', { entityType: 'auth', entityId: lower, ip, userAgent: req.headers.get('user-agent') ?? '' }),
  ]);

  const supabase = await authClient();
  await supabase.auth.signInWithPassword({ email: authEmailFor(lower), password });
  (await cookies()).delete(UNLOCK_COOKIE);

  return json({ ok: true, next: '/' });
}
