import { cookies } from 'next/headers';
import { admin, authEmailFor } from '@/lib/supabase/server';
import { assertEnv } from '@/lib/env';
import { audit, clientIp, ERRORS, fail, guard, json, rejectCrossSite } from '@/lib/api';
import { makePasswordVerifier, verifyPassword } from '@/lib/crypto';
import { UNLOCK_COOKIE } from '@/lib/auth';
import { parse, passwordChangeInput, recoveryEmailInput, usernameChangeInput } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Account changes. Both require the current password, and both drop the vault
 * unlock cookie so a stolen session cannot keep reading secrets afterwards.
 */
export async function POST(req: Request) {
  assertEnv();
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;
  const auth = await guard();
  if (!auth.ok) return auth.response;
  const { profile } = auth;

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const ip = await clientIp(req);
  const db = admin();

  if (body.action === 'password') {
    const parsed = parse(passwordChangeInput, body);
    if (!parsed.ok) return fail(ERRORS.VALIDATION, 'Check the passwords.', 400, { issues: parsed.issues });

    if (!verifyPassword(parsed.value.current_password, profile.reveal_salt, profile.reveal_hash)) {
      await audit(profile.id, 'password_change_denied', { entityType: 'profile', entityId: profile.id, ip });
      return fail(ERRORS.UNAUTHENTICATED, 'Current password is incorrect.', 401);
    }

    const { error: authErr } = await db.auth.admin.updateUserById(profile.id, { password: parsed.value.new_password });
    if (authErr) return fail(ERRORS.SERVER, 'Could not update the password on the auth service.', 500);

    const verifier = makePasswordVerifier(parsed.value.new_password);
    const { error } = await db
      .from('profiles')
      .update({ reveal_salt: verifier.salt, reveal_hash: verifier.hash })
      .eq('id', profile.id);
    if (error) return fail(ERRORS.SERVER, error.message, 500);

    (await cookies()).delete(UNLOCK_COOKIE);
    await audit(profile.id, 'password.change', { entityType: 'profile', entityId: profile.id, ip });
    return json({ ok: true });
  }

  if (body.action === 'recovery_email') {
    const parsed = parse(recoveryEmailInput, body);
    if (!parsed.ok) return fail(ERRORS.VALIDATION, 'Check the email address and password.', 400, { issues: parsed.issues });
    if (!verifyPassword(parsed.value.password, profile.reveal_salt, profile.reveal_hash)) {
      await audit(profile.id, 'recovery_email_denied', { entityType: 'profile', entityId: profile.id, ip });
      return fail(ERRORS.UNAUTHENTICATED, 'Password is incorrect.', 401);
    }

    // The sign-in identity is a fake address, so saving it as the recovery target
    // would make reset requests silently go nowhere.
    if (parsed.value.email.endsWith('@vault.webvault.app')) {
      return fail(ERRORS.VALIDATION, 'Use a real inbox you can open.', 400);
    }

    const { error } = await db.from('profiles').update({ recovery_email: parsed.value.email }).eq('id', profile.id);
    if (error) return fail(ERRORS.SERVER, error.message, 500);

    await audit(profile.id, 'recovery.change', {
      entityType: 'profile',
      entityId: profile.id,
      detail: { configured: parsed.value.email !== '' },
      ip,
    });
    return json({ ok: true, configured: parsed.value.email !== '' });
  }

  if (body.action === 'username') {
    const parsed = parse(usernameChangeInput, body);
    if (!parsed.ok) return fail(ERRORS.VALIDATION, 'Check the username and password.', 400, { issues: parsed.issues });
    if (!verifyPassword(parsed.value.password, profile.reveal_salt, profile.reveal_hash)) {
      return fail(ERRORS.UNAUTHENTICATED, 'Password is incorrect.', 401);
    }

    const next = parsed.value.username.toLowerCase();
    const { data: taken } = await db.from('profiles').select('id').eq('username', next).neq('id', profile.id).maybeSingle();
    if (taken) return fail(ERRORS.CONFLICT, 'That username is already taken.', 409);

    const { error: authErr } = await db.auth.admin.updateUserById(profile.id, {
      email: authEmailFor(next),
      email_confirm: true,
      user_metadata: { username: next },
    });
    if (authErr) return fail(ERRORS.SERVER, 'Could not update the sign-in identity.', 500);

    const { error } = await db.from('profiles').update({ username: next }).eq('id', profile.id);
    if (error) return fail(ERRORS.SERVER, error.message, 500);

    (await cookies()).delete(UNLOCK_COOKIE);
    await audit(profile.id, 'username.change', { entityType: 'profile', entityId: profile.id, ip });
    return json({ ok: true, username: next });
  }

  return fail(ERRORS.VALIDATION, 'Unknown action.', 400);
}
