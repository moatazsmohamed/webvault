import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PROTECTED = ['/dashboard', '/rooms', '/websites', '/vault', '/settings'];
const PUBLIC = ['/login'];

const isProtected = (path: string) => PROTECTED.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
const isPublic = (path: string) => PUBLIC.some(prefix => path === prefix || path.startsWith(`${prefix}/`));

/**
 * Convenience layer only — it is NOT the authorisation boundary.
 * Every protected page calls requireProfile() and every API route calls guard(),
 * so removing this file changes nothing about who can read data. Its jobs are to
 * (1) refresh the auth cookie before it expires so a real session survives and
 * (2) bounce obvious no-session requests before a server component runs.
 */
export async function middleware(req: NextRequest) {
  const res = NextResponse.next({ request: { headers: req.headers } });

  const url = req.nextUrl.clone();
  const path = url.pathname;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const supabaseUrl = process.env.SUPABASE_URL ?? '';

  if (!serviceKey || !supabaseUrl) {
    // Misconfigured deploy: let the pages render and let assertEnv() report it clearly.
    return res;
  }

  const hasSession = req.cookies.getAll().some(c => c.name.startsWith('sb-'));

  if (isPublic(path) && hasSession) {
    return NextResponse.redirect(new URL('/dashboard', url));
  }
  if (!isProtected(path)) return res;

  const supabase = createServerClient(supabaseUrl, serviceKey, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      get: (name: string) => req.cookies.get(name)?.value,
      set: (name: string, value: string, options: CookieOptions) => {
        res.cookies.set({ name, value, ...options });
      },
      remove: (name: string, options: CookieOptions) => {
        res.cookies.set({ name, value: '', ...options, maxAge: 0 });
      },
    },
  });

  // getSession() rotates the pair when the access token has expired.
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    const redirectUrl = new URL('/login', url);
    const out = NextResponse.redirect(redirectUrl);
    for (const cookie of req.cookies.getAll()) {
      if (cookie.name.startsWith('sb-')) out.cookies.delete(cookie.name);
    }
    return out;
  }
  return res;
}

export const config = {
  matcher: ['/dashboard/:path*', '/rooms/:path*', '/websites/:path*', '/vault/:path*', '/settings/:path*', '/login'],
};
