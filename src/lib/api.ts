import 'server-only';
import { NextResponse } from 'next/server';
import { admin } from './supabase/server';
import { currentProfile, isVaultUnlocked, type Profile } from './auth';

export const ERRORS = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION: 'VALIDATION_FAILED',
  THROTTLED: 'THROTTLED',
  VAULT_LOCKED: 'VAULT_LOCKED',
  VAULT_DECRYPT_FAILED: 'VAULT_DECRYPT_FAILED',
  CONFLICT: 'CONFLICT',
  SERVER: 'SERVER_ERROR',
} as const;

export type ErrorCode = (typeof ERRORS)[keyof typeof ERRORS];

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, { ...init, headers: { 'cache-control': 'no-store', ...(init?.headers ?? {}) } });
}

export function fail(code: ErrorCode, message: string, status = 400, extra?: Record<string, unknown>) {
  return json({ error: code, message, ...extra }, { status });
}

/** Every API handler starts here: identity is read from the verified session, never from the request body. */
export async function guard(): Promise<
  { ok: true; profile: Profile; unlocked: boolean } | { ok: false; response: NextResponse }
> {
  const profile = await currentProfile();
  if (!profile) {
    return { ok: false, response: fail(ERRORS.UNAUTHENTICATED, 'Sign in required.', 401) };
  }
  const unlocked = await isVaultUnlocked(profile.id);
  return { ok: true, profile, unlocked };
}

export async function clientIp(req: Request): Promise<string> {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

/**
 * Same-origin gate for every mutating request. Combined with SameSite=Lax
 * session cookies this is the CSRF defence — the session cookie can never be
 * sent by a cross-site form POST, and a cross-origin fetch is rejected here.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true; // same-origin form post or non-browser client
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

export function rejectCrossSite(req: Request): NextResponse | null {
  if (sameOrigin(req)) return null;
  return fail(ERRORS.FORBIDDEN, 'Cross-origin request blocked.', 403);
}

/**
 * Audit trail. `detail` is checked here so a secret can never be logged even by
 * accident, and the database has a matching CHECK constraint as a second net.
 */
const SECRETISH = /(password|passwd|secret|token|apikey|api_key|authorization|credential)/i;

export async function audit(
  profileId: string | null,
  action: string,
  opts: { entityType?: string; entityId?: string; detail?: Record<string, unknown>; ip?: string; userAgent?: string } = {},
): Promise<void> {
  const detail = opts.detail ?? {};
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (SECRETISH.test(k)) continue;
    if (typeof v === 'string' && v.length > 200) continue;
    safe[k] = v;
  }
  try {
    await admin().from('activity_logs').insert({
      owner_id: profileId,
      action,
      entity_type: opts.entityType ?? '',
      entity_id: opts.entityId ?? '',
      detail: safe,
      ip: opts.ip ?? '',
      user_agent: (opts.userAgent ?? '').slice(0, 300),
    });
  } catch {
    /* logging must never break the request */
  }
}
