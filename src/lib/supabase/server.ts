import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

/**
 * `admin` — service-role client. Bypasses RLS. Server-side data access only.
 * `browser` — cookie-bound client used purely to read/refresh the auth session.
 * Neither is ever imported by a client component.
 */

let cachedAdmin: SupabaseClient | null = null;

export function admin(): SupabaseClient {
  if (!cachedAdmin) {
    cachedAdmin = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cachedAdmin;
}

export async function sessionClient(): Promise<SupabaseClient> {
  const store = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseServiceKey, {
    cookies: {
      getAll: () => store.getAll(),
      get: (name: string) => store.get(name)?.value,
      set: () => {
        /* The session cookie is written only by the login/logout routes, so a
           read-only client never tries to mutate it here. */
      },
      remove: () => {},
    },
  });
}

/**
 * Cookie-writing client, used ONLY by /api/auth/login and /api/auth/logout.
 * In a Route Handler Next.js flushes these mutations onto the response, which is
 * how the httpOnly session cookie reaches the browser.
 */
export async function authClient(): Promise<SupabaseClient> {
  const store = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseServiceKey, {
    cookies: {
      getAll: () => store.getAll(),
      get: (name: string) => store.get(name)?.value,
      set: (name: string, value: string, options: CookieOptions) => {
        try {
          store.set({ name, value, ...options });
        } catch {
          /* reading cookies in a middleware context can freeze the store */
        }
      },
      remove: (name: string, options: CookieOptions) => {
        try {
          store.set({ name, value: '', ...options, maxAge: 0 });
        } catch {
          /* ignore */
        }
      },
    },
  });
}

/** WebVault logs in with a username, Supabase needs an address — this mapping is deterministic. */
export const authEmailFor = (username: string): string => `${username.toLowerCase()}@vault.webvault.app`;
