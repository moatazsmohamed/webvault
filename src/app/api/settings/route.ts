import { admin } from '@/lib/supabase/server';
import { assertEnv } from '@/lib/env';
import { audit, ERRORS, fail, guard, json, rejectCrossSite } from '@/lib/api';
import { parse, profileSettingsInput } from '@/lib/validation';
import { LOCALE_COOKIE, THEME_COOKIE } from '@/lib/auth';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request) {
  assertEnv();
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;
  const auth = await guard();
  if (!auth.ok) return auth.response;

  const parsed = parse(profileSettingsInput, await req.json().catch(() => null));
  if (!parsed.ok) return fail(ERRORS.VALIDATION, 'Check the settings.', 400, { issues: parsed.issues });

  const { error } = await admin()
    .from('profiles')
    .update({ display_name: parsed.value.display_name, locale: parsed.value.locale, theme: parsed.value.theme })
    .eq('id', auth.profile.id);
  if (error) return fail(ERRORS.SERVER, error.message, 500);

  const store = await cookies();
  store.set({ name: LOCALE_COOKIE, value: parsed.value.locale, httpOnly: false, sameSite: 'lax', path: '/', maxAge: 31536000 });
  store.set({ name: THEME_COOKIE, value: parsed.value.theme, httpOnly: false, sameSite: 'lax', path: '/', maxAge: 31536000 });

  await audit(auth.profile.id, 'settings.update', { entityType: 'profile', entityId: auth.profile.id });
  return json({ ok: true });
}
