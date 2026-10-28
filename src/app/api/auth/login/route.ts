import { NextResponse } from 'next/server';
import { admin, authClient, authEmailFor } from '@/lib/supabase/server';
import { assertEnv, env } from '@/lib/env';
import { audit, clientIp, ERRORS, fail, json, rejectCrossSite } from '@/lib/api';
import { makePasswordVerifier } from '@/lib/crypto';
import { loginInput, parse, setupInput } from '@/lib/validation';

export const runtime = 'nodejs';

const LOCK_AFTER = 5;
const LOCK_SECONDS = 15 * 60;

async function attemptState(key: string) {
  const { data } = await admin().rpc('auth_attempt_state', { p_key: key });
  const state = (data ?? { attempts: 0, locked_until: null }) as { attempts: number; locked_until: string | null };
  const lockedUntil = state.locked_until ? new Date(state.locked_until).getTime() : 0;
  return { locked: lockedUntil > Date.now(), retryAfter: lockedUntil ? Math.ceil((lockedUntil - Date.now()) / 1000) : 0 };
}

/** True when the deployment has no account yet — the only window /setup is open in. */
async function isFirstRun(): Promise<boolean> {
  const { data } = await admin().rpc('webvault_is_first_run');
  return data === true;
}

export async function GET() {
  assertEnv();
  return json({ ok: true, firstRun: await isFirstRun() });
}

export async function POST(req: Request) {
  assertEnv();
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;

  const parsed = parse(loginInput, await req.json().catch(() => null));
  if (!parsed.ok) return fail(ERRORS.VALIDATION, 'Check the values you entered.', 400, { issues: parsed.issues });

  const ip = await clientIp(req);
  const username = parsed.value.username.toLowerCase();
  const ipKey = `login:ip:${ip}`;
  const userKey = `login:user:${username}`;

  const [ipState, userState] = await Promise.all([attemptState(ipKey), attemptState(userKey)]);
  if (ipState.locked || userState.locked) {
    return fail(ERRORS.THROTTLED, 'Too many attempts.', 429, { retry_after: Math.max(ipState.retryAfter, userState.retryAfter) });
  }

  const supabase = await authClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: authEmailFor(username),
    password: parsed.value.password,
  });

  if (error || !data.user) {
    await Promise.all([
      admin().rpc('auth_take_attempt', { p_key: ipKey, p_max_attempts: LOCK_AFTER, p_lock_seconds: LOCK_SECONDS }),
      admin().rpc('auth_take_attempt', { p_key: userKey, p_max_attempts: LOCK_AFTER, p_lock_seconds: LOCK_SECONDS }),
    ]);
    await audit(null, 'login_failed', { entityType: 'auth', entityId: username, ip, userAgent: req.headers.get('user-agent') ?? '' });
    // One message for "no such user" and "wrong password" — no account enumeration.
    return fail(ERRORS.UNAUTHENTICATED, 'Invalid credentials.', 401);
  }

  const { data: profile } = await admin().from('profiles').select('id').eq('id', data.user.id).eq('username', username).maybeSingle();
  if (!profile) {
    await supabase.auth.signOut();
    return fail(ERRORS.FORBIDDEN, 'This account is not registered in WebVault.', 403);
  }

  await Promise.all([
    admin().rpc('auth_clear_attempt', { p_key: ipKey }),
    admin().rpc('auth_clear_attempt', { p_key: userKey }),
    audit(profile.id, 'login', { entityType: 'auth', ip, userAgent: req.headers.get('user-agent') ?? '' }),
  ]);

  return json({ ok: true, next: '/' });
}

/**
 * Account bootstrap. Closes itself once a profile exists, and stays open only while
 * WEBVAULT_INVITE_KEY is set and presented — so the owner can add a second device
 * or a second account without leaving setup unlocked for strangers.
 */
export async function PUT(req: Request) {
  assertEnv();
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;

  const body0 = await req.clone().json().catch(() => ({}) as Record<string, unknown>);
  const presentedKey = String(body0?.setup_key ?? '');
  const firstRun = await isFirstRun();
  const invited = !firstRun && !!env.inviteKey && presentedKey === env.inviteKey;
  if (!firstRun && !invited) return fail(ERRORS.FORBIDDEN, 'Setup is closed.', 403);
  if (firstRun && env.setupKey && presentedKey !== env.setupKey) {
    await audit(null, 'setup_denied', { ip: await clientIp(req) });
    return fail(ERRORS.FORBIDDEN, 'Setup key rejected.', 403);
  }

  const parsed = parse(setupInput, await req.json().catch(() => null));
  if (!parsed.ok) return fail(ERRORS.VALIDATION, 'Check the values you entered.', 400, { issues: parsed.issues });

  const { username, password, display_name, locale } = parsed.value;
  const adminClient = admin();
  const email = authEmailFor(username);
  const verifier = makePasswordVerifier(password);

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username, display_name },
  });
  if (createError || !created.user) {
    return fail(ERRORS.SERVER, createError?.message ?? 'Could not create the account.', 500);
  }

  const { error: profileError } = await adminClient.from('profiles').insert({
    id: created.user.id,
    username: username.toLowerCase(),
    display_name: display_name || username,
    locale,
    theme: 'dark',
    reveal_salt: verifier.salt,
    reveal_hash: verifier.hash,
  });
  if (profileError) {
    await adminClient.auth.admin.deleteUser(created.user.id);
    return fail(ERRORS.SERVER, 'Could not save the profile.', 500);
  }

  const supabase = await authClient();
  await supabase.auth.signInWithPassword({ email, password });
  await audit(created.user.id, 'setup_complete', { entityType: 'auth', ip: await clientIp(req) });

  return NextResponse.json({ ok: true, next: '/' }, { headers: { 'cache-control': 'no-store' } });
}
