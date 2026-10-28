import { admin } from '@/lib/supabase/server';
import { assertEnv } from '@/lib/env';
import { audit, clientIp, ERRORS, fail, json, rejectCrossSite } from '@/lib/api';
import { hashCode, randomRecoveryCode } from '@/lib/crypto';
import { mailEnabled, RECOVERY_MAX_SENDS, RECOVERY_SEND_WINDOW_SECONDS, RECOVERY_TTL_SECONDS, sendRecoveryCode } from '@/lib/mail';
import { forgotRequestInput, parse } from '@/lib/validation';

export const runtime = 'nodejs';

/**
 * Step 1 of recovery: mail a one-time code to the address the account owner
 * stored in Settings. Every branch answers the same way, so this endpoint cannot
 * be used to learn which usernames exist or whether one has a recovery address.
 */
export async function POST(req: Request) {
  assertEnv();
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;

  if (!mailEnabled()) {
    return fail(ERRORS.SERVER, 'Recovery email is not configured on this deployment.', 503);
  }

  const parsed = parse(forgotRequestInput, await req.json().catch(() => null));
  if (!parsed.ok) return fail(ERRORS.VALIDATION, 'Check the username.', 400, { issues: parsed.issues });

  const ip = await clientIp(req);
  const username = parsed.value.username.toLowerCase();
  const userKey = `reset:send:user:${username}`;
  const ipKey = `reset:send:ip:${ip}`;
  const db = admin();

  const [userState, ipState] = await Promise.all([
    db.rpc('auth_attempt_state', { p_key: userKey }),
    db.rpc('auth_attempt_state', { p_key: ipKey }),
  ]);
  const retryAfter = [userState.data, ipState.data]
    .map(s => (s as { locked_until: string | null } | null)?.locked_until)
    .reduce<number>((max, until) => (until ? Math.max(max, Math.ceil((new Date(until).getTime() - Date.now()) / 1000)) : max), 0);
  if (retryAfter > 0) return fail(ERRORS.THROTTLED, 'Too many requests.', 429, { retry_after: retryAfter });

  const { data: profile } = await db
    .from('profiles')
    .select('id,recovery_email')
    .eq('username', username)
    .maybeSingle();

  // The counter moves whether or not the account exists, so request rates cannot
  // be probed for membership either.
  await Promise.all([
    db.rpc('auth_take_attempt', {
      p_key: userKey,
      p_max_attempts: RECOVERY_MAX_SENDS,
      p_window_seconds: RECOVERY_SEND_WINDOW_SECONDS,
      p_lock_seconds: RECOVERY_SEND_WINDOW_SECONDS,
    }),
    db.rpc('auth_take_attempt', {
      p_key: ipKey,
      p_max_attempts: RECOVERY_MAX_SENDS,
      p_window_seconds: RECOVERY_SEND_WINDOW_SECONDS,
      p_lock_seconds: RECOVERY_SEND_WINDOW_SECONDS,
    }),
  ]);

  const email = profile?.recovery_email ?? '';
  if (email) {
    const code = randomRecoveryCode();
    const { error: rpcError } = await db.rpc('webvault_begin_reset', {
      p_user: profile!.id,
      p_code_hash: hashCode(profile!.id, code),
      p_ttl_seconds: RECOVERY_TTL_SECONDS,
    });
    const delivered = rpcError ? false : await sendRecoveryCode(email, code);
    await audit(profile!.id, 'password_reset_request', {
      entityType: 'auth',
      entityId: username,
      detail: { delivered },
      ip,
      userAgent: req.headers.get('user-agent') ?? '',
    });
  }

  // Same answer for "no such user", "no recovery address stored" and "the
  // transport failed" — delivery outcome lives only in the audit trail.
  return json({ ok: true });
}
