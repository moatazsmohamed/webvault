import 'server-only';

/**
 * Environment is validated once, at module load, and the app refuses to boot
 * with a weak or missing secret rather than silently running unprotected.
 */

const MISSING: string[] = [];

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    MISSING.push(name);
    return '';
  }
  return value.trim();
}

function base64Key(name: string, value: string): Buffer {
  if (!value) return Buffer.alloc(0);
  let buf: Buffer;
  try {
    buf = Buffer.from(value, 'base64');
  } catch {
    throw new Error(`${name} must be base64`);
  }
  if (buf.length !== 32) {
    throw new Error(`${name} must decode to exactly 32 bytes (AES-256). Generate one with: node scripts/gen-secrets.mjs`);
  }
  return buf;
}

const raw = {
  url: required('SUPABASE_URL', process.env.SUPABASE_URL),
  serviceKey: required('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY),
  encKey: required('WEBVAULT_ENC_KEY', process.env.WEBVAULT_ENC_KEY),
  sessionSecret: required('WEBVAULT_SESSION_SECRET', process.env.WEBVAULT_SESSION_SECRET),
  setupKey: process.env.WEBVAULT_SETUP_KEY?.trim() ?? '',
  inviteKey: process.env.WEBVAULT_INVITE_KEY?.trim() ?? '',
  appUrl: process.env.NEXT_PUBLIC_APP_URL?.trim() || '',
};

if (raw.sessionSecret && !/^[0-9a-f]{48,}$/i.test(raw.sessionSecret)) {
  throw new Error('WEBVAULT_SESSION_SECRET must be at least 48 hex characters (generate one with: node scripts/gen-secrets.mjs)');
}

export const env = {
  supabaseUrl: raw.url,
  supabaseServiceKey: raw.serviceKey,
  encKey: base64Key('WEBVAULT_ENC_KEY', raw.encKey),
  sessionSecret: raw.sessionSecret,
  setupKey: raw.setupKey,
  inviteKey: raw.inviteKey,
  appUrl: raw.appUrl,
  isProd: process.env.NODE_ENV === 'production',
  get ready(): boolean {
    return MISSING.length === 0;
  },
  get missing(): readonly string[] {
    return MISSING;
  },
};

/** Called at the top of every route handler so a misconfigured deploy fails loudly, not quietly. */
export function assertEnv(): void {
  if (MISSING.length > 0) {
    throw new Error(`Missing environment variables: ${MISSING.join(', ')}`);
  }
}
