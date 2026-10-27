import { cookies } from 'next/headers';
import { authClient } from '@/lib/supabase/server';
import { assertEnv } from '@/lib/env';
import { audit, clientIp, json, rejectCrossSite } from '@/lib/api';
import { currentProfile, UNLOCK_COOKIE } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  assertEnv();
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;

  const profile = await currentProfile();
  const supabase = await authClient();
  await supabase.auth.signOut({ scope: 'local' });
  await supabase.auth.signOut({ scope: 'global' });

  const store = await cookies();
  store.delete(UNLOCK_COOKIE);

  if (profile) await audit(profile.id, 'logout', { entityType: 'auth', ip: await clientIp(req) });
  return json({ ok: true });
}
