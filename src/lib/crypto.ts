import 'server-only';
import crypto from 'node:crypto';
import { env } from './env';

/**
 * Envelope format stored in Postgres:   v<keyVersion>.<iv>.<tag>.<ciphertext>
 * all three binary parts base64. AES-256-GCM gives both confidentiality and
 * integrity — a tampered row fails the auth tag instead of decrypting to junk.
 */

const VERSION = 1;
const IV_BYTES = 12; // 96-bit nonce, the GCM standard
const TAG_BYTES = 16;

export class VaultError extends Error {
  constructor(message = 'VAULT_DECRYPT_FAILED') {
    super(message);
    this.name = 'VaultError';
  }
}

function keyFor(version: number): Buffer {
  if (version !== VERSION) throw new VaultError('VAULT_KEY_VERSION_UNKNOWN');
  return env.encKey;
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(VERSION), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v${VERSION}.${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
}

export function decrypt(envelope: string | null | undefined): string {
  if (!envelope) throw new VaultError();
  const parts = envelope.split('.');
  if (parts.length !== 4) throw new VaultError();
  const version = Number(parts[0]?.slice(1));
  const iv = Buffer.from(parts[1] ?? '', 'base64');
  const tag = Buffer.from(parts[2] ?? '', 'base64');
  const ct = Buffer.from(parts[3] ?? '', 'base64');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || ct.length === 0) throw new VaultError();

  const decipher = crypto.createDecipheriv('aes-256-gcm', keyFor(version), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    // Never let padding/tag detail escape — the message itself is the signal.
    throw new VaultError();
  }
}

/** Deterministic, non-reversible index so the server can match a username without decrypting it. */
export function blindIndex(value: string): string {
  return crypto.createHmac('sha256', env.encKey).update(value.trim().toLowerCase()).digest('hex');
}

/** What the UI shows before anyone unlocks the vault: "a…n" for "admin@x.com". */
export function hint(value: string): string {
  const v = value.trim();
  // Below five characters a two-each-side mask would show most of the value back.
  if (v.length <= 4) return '••••';
  return `${v.slice(0, 2)}${'•'.repeat(Math.min(6, Math.max(3, v.length - 4)))}${v.slice(-2)}`;
}

// ─── password verifier for the re-auth-before-reveal step ────────────────────

const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 } as const;

export function makePasswordVerifier(password: string): { salt: string; hash: string } {
  const salt = crypto.randomBytes(16).toString('base64');
  return { salt, hash: scrypt(password, salt) };
}

function scrypt(password: string, salt: string): string {
  // N=32768,r=8 needs 32 MB of scratch memory, which is exactly Node's default
  // cap — the real usage is higher, so maxmem has to be raised or scrypt throws.
  return crypto.scryptSync(password, Buffer.from(salt, 'base64'), SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem,
  }).toString('base64');
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  if (!salt || !expectedHash) return false;
  let actual: Buffer;
  let expected: Buffer;
  try {
    actual = Buffer.from(scrypt(password, salt), 'base64');
    expected = Buffer.from(expectedHash, 'base64');
  } catch {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// ─── signed, short-lived "vault unlocked" token ──────────────────────────────

export type UnlockPayload = { sub: string; exp: number; purpose: 'vault-unlock' };

export function signToken(payload: UnlockPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', env.sessionSecret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function readToken(token: string | undefined | null): UnlockPayload | null {
  if (!token) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', env.sessionSecret).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as UnlockPayload;
    if (parsed.purpose !== 'vault-unlock' || typeof parsed.exp !== 'number' || parsed.exp * 1000 < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

// ─── one-time recovery codes ────────────────────────────────────────────────

/** Six digits — short enough to type from an email on a phone, long enough for a 10-minute TTL and 5 tries. */
export function randomRecoveryCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** Only the HMAC is ever stored, so a database dump cannot be replayed as a code. */
export function hashCode(userId: string, code: string): string {
  return crypto.createHmac('sha256', env.sessionSecret).update(`${userId}.${code.trim()}`).digest('hex');
}

/**
 * `iat` from a GoTrue access token, used to refuse sessions minted before a
 * password reset. Decoding without verifying is safe here: `currentProfile()`
 * has already asked GoTrue to validate the same token, and a forged cookie would
 * fail that check before this value is ever compared.
 */
export function tokenIssuedAt(accessToken: string | null | undefined): number | null {
  const payload = accessToken?.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { iat?: unknown };
    return typeof claims.iat === 'number' ? claims.iat : null;
  } catch {
    return null;
  }
}
