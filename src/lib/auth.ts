import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { admin, sessionClient } from './supabase/server';
import { readToken, signToken } from './crypto';

export const UNLOCK_COOKIE = 'wv_unlock';
export const UNLOCK_SECONDS = 5 * 60;
export const LOCALE_COOKIE = 'wv_locale';
export const THEME_COOKIE = 'wv_theme';

export type Profile = {
  id: string;
  username: string;
  display_name: string;
  locale: 'ar' | 'en';
  theme: 'dark' | 'light';
  reveal_salt: string;
  reveal_hash: string;
  created_at: string;
};

/** The single source of truth for "who is allowed in". */
export async function currentProfile(): Promise<Profile | null> {
  const supabase = await sessionClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const { data: profile, error: pErr } = await admin()
    .from('profiles')
    .select('id,username,display_name,locale,theme,reveal_salt,reveal_hash,created_at')
    .eq('id', data.user.id)
    .maybeSingle();

  if (pErr || !profile) return null;
  return profile as Profile;
}

/** Pages: bounce to /login. API routes use `guard()` in lib/api instead. */
export async function requireProfile(): Promise<Profile> {
  const profile = await currentProfile();
  if (!profile) redirect('/login');
  return profile;
}

export async function issueUnlockToken(userId: string): Promise<string> {
  return signToken({ sub: userId, exp: Math.floor(Date.now() / 1000) + UNLOCK_SECONDS, purpose: 'vault-unlock' });
}

/** True only while the vault is unlocked for THIS account and the token has not expired. */
export async function isVaultUnlocked(userId: string): Promise<boolean> {
  const store = await cookies();
  const payload = readToken(store.get(UNLOCK_COOKIE)?.value);
  return !!payload && payload.sub === userId;
}

export const authAdmin = () => admin();

/** Cookie wins, profile is the fallback — used by the shell and by every page. */
export async function uiPrefs(profile: Profile): Promise<{ locale: 'ar' | 'en'; theme: 'dark' | 'light' }> {
  const store = await cookies();
  const cookieLocale = store.get(LOCALE_COOKIE)?.value;
  const cookieTheme = store.get(THEME_COOKIE)?.value;
  return {
    locale: cookieLocale === 'en' || cookieLocale === 'ar' ? cookieLocale : profile.locale,
    theme: cookieTheme === 'light' || cookieTheme === 'dark' ? cookieTheme : profile.theme,
  };
}
