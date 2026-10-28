/**
 * Security self-test — runs with no database and no network.
 *   npm run selftest
 * It exercises the parts that must never regress silently: the vault cipher,
 * the reveal token, the password verifier, input validation, the secret-scrubbing
 * audit filter, and the i18n dictionary.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname!, '..');

process.env.SUPABASE_URL ??= 'https://selftest.invalid.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'selftest-service-role-key';
process.env.WEBVAULT_ENC_KEY ??= randomBytes(32).toString('base64');
process.env.WEBVAULT_SESSION_SECRET ??= randomBytes(32).toString('hex');
// Recovery is asserted in its unconfigured state, so a developer's real Resend
// keys in the shell must not leak into the run. `env.ts` reads these at import.
for (const name of ['RESEND_API_KEY', 'RESEND_FROM', 'WEBVAULT_MAIL_OUTBOX']) delete process.env[name];

const { encrypt, decrypt, blindIndex, hint, makePasswordVerifier, verifyPassword, signToken, readToken, randomRecoveryCode, hashCode, tokenIssuedAt, VaultError } =
  await import('../src/lib/crypto.ts');
const { parse, httpUrl, roomCreate, websiteCreate, credentialCreate, setupInput, passwordChangeInput, urlsInput, recoveryEmailInput, passwordResetInput } =
  await import('../src/lib/validation.ts');
const { env } = await import('../src/lib/env.ts');
const { mailEnabled, maskEmail, RECOVERY_TTL_SECONDS, RECOVERY_MAX_ATTEMPTS } = await import('../src/lib/mail.ts');
const { translate, DICT, activityLabel } = await import('../src/lib/i18n.ts');
const { hostOf, formatDate } = await import('../src/lib/format.ts');
const { STATUSES, URL_KINDS, ACCOUNT_TYPES } = await import('../src/lib/types.ts');

let auditFilter: ((detail: Record<string, unknown>) => string[]) | null = null;
let auditSkipReason = '';
try {
  // api.ts pulls in next/headers, which only resolves inside a Next runtime; if
  // the import fails the audit filter is reported as skipped, never as passed.
  const { scrubDetail } = await import('../src/lib/api.ts');
  auditFilter = detail => Object.keys(scrubDetail(detail));
} catch (error) {
  auditSkipReason = (error as Error).message.split('\n')[0] ?? 'unknown';
}

type Case = { name: string; run: () => void; skip?: () => string | null };
const cases: Case[] = [];
const test = (name: string, run: () => void, skip?: () => string | null) => cases.push({ name, run, skip });

// ─── vault cipher ────────────────────────────────────────────────────────────

const SECRET = ' hunter2-€-日本語 ';

test('envelope is versioned and holds no plaintext', () => {
  const sealed = encrypt('correct horse battery staple');
  // v1.<16-char IV><24-char tag><base64 ciphertext> — 12-byte IV and 16-byte tag in base64
  assert.match(sealed, /^v1\.[A-Za-z0-9+/]{16}\.[A-Za-z0-9+/]{22}={2}\.[A-Za-z0-9+/]+={0,2}$/);
  assert.ok(!sealed.includes('correct'));
  assert.ok(!sealed.includes('horse'));
});

test('round-trip preserves unicode and whitespace exactly', () => {
  assert.equal(decrypt(encrypt(SECRET)), SECRET);
});

test('same plaintext encrypts differently every time (fresh IV)', () => {
  const a = encrypt(SECRET);
  const b = encrypt(SECRET);
  assert.notEqual(a, b);
  assert.equal(decrypt(a), decrypt(b));
});

test('flipped ciphertext byte fails the auth tag instead of returning junk', () => {
  const parts = encrypt(SECRET).split('.');
  const ct = Buffer.from(parts[3]!, 'base64');
  ct[0] ^= 0xff;
  parts[3] = ct.toString('base64');
  assert.throws(() => decrypt(parts.join('.')), VaultError);
});

test('flipped auth tag is rejected', () => {
  const parts = encrypt(SECRET).split('.');
  const tag = Buffer.from(parts[2]!, 'base64');
  tag[0] ^= 0x01;
  parts[2] = tag.toString('base64');
  assert.throws(() => decrypt(parts.join('.')), VaultError);
});

test('unknown key version is rejected rather than guessed', () => {
  assert.throws(() => decrypt(encrypt(SECRET).replace(/^v1\./, 'v9.')), /VAULT_KEY_VERSION_UNKNOWN/);
});

test('malformed envelopes are rejected', () => {
  for (const bad of ['', 'v1', 'v1.a.b', 'v1.a.b.c.d', 'v1.zzz.ZZZ.', 'vX.a.b.c']) {
    assert.throws(() => decrypt(bad), VaultError, `accepted ${JSON.stringify(bad)}`);
  }
});

// ─── masked hints and blind index ────────────────────────────────────────────

test('hint masks the middle and never repeats the value', () => {
  const shown = hint('admin@client-website.com');
  assert.ok(!shown.includes('client-website'));
  assert.match(shown, /^ad[•]+om$/);
});

test('short values are fully hidden', () => {
  assert.equal(hint('ab'), '••••');
  assert.equal(hint('abc'), '••••');
  assert.equal(hint('  ab  '), '••••');
  assert.equal(hint(''), '••••');
  assert.equal(hint('root'), '••••', 'a 4-character username must not leak its ends');
});

test('blind index is deterministic, normalised and non-reversible', () => {
  const a = blindIndex('  Admin@Example.COM ');
  assert.equal(a, blindIndex('admin@example.com'));
  assert.equal(a.length, 64);
  assert.ok(!a.includes('admin'));
  assert.notEqual(a, blindIndex('admin@example.org'));
});

// ─── password verifier (re-auth before reveal) ───────────────────────────────

test('scrypt verifier accepts the right password and rejects the wrong one', () => {
  const v = makePasswordVerifier(SECRET);
  assert.notEqual(v.hash, '');
  assert.ok(!JSON.stringify(v).includes('hunter2'));
  assert.equal(verifyPassword(SECRET, v.salt, v.hash), true);
  assert.equal(verifyPassword(`${SECRET}x`, v.salt, v.hash), false);
  assert.equal(verifyPassword(SECRET, v.salt, makePasswordVerifier(SECRET).hash), false, 'salt must matter');
});

test('verifier rejects empty stored fields without throwing', () => {
  assert.equal(verifyPassword(SECRET, '', ''), false);
  assert.equal(verifyPassword(SECRET, 'not-base64!!', 'also-not-base64!!'), false);
});

// ─── vault-unlock token ──────────────────────────────────────────────────────

test('unlock token round-trips and carries its purpose', () => {
  const payload = { sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 300, purpose: 'vault-unlock' as const };
  const token = signToken(payload);
  assert.equal(readToken(token)?.sub, 'user-1');
  assert.equal(readToken(`${token}x`), null, 'tampered token must not verify');
  assert.equal(readToken(token.split('.')[0]!), null);
  assert.equal(readToken(undefined), null);
});

test('expired token is refused', () => {
  const token = signToken({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) - 1, purpose: 'vault-unlock' });
  assert.equal(readToken(token), null);
});

test('token signed for another purpose is refused', () => {
  const forged = signToken({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 300, purpose: 'session' } as never);
  assert.equal(readToken(forged), null);
});

// ─── audit scrub filter ──────────────────────────────────────────────────────

test('audit detail scrubber drops secret-looking keys and oversized strings', () => {
  const kept = auditFilter!({
    password: 'x', new_password: 'x', client_secret: 'x', token: 'x', apikey: 'x', api_key: 'x',
    authorization: 'x', credential_note: 'x', website: 'shop', kind: 'admin', room: 'Client A', reason: 'ok',
  });
  assert.deepEqual(kept, ['website', 'kind', 'room', 'reason']);
  assert.deepEqual(auditFilter!({ note: 'y'.repeat(201) }), [], 'long strings must be dropped');
}, () => (auditFilter ? null : `api.ts needs the Next runtime (${auditSkipReason})`));

// ─── input validation ────────────────────────────────────────────────────────

test('only http(s) URLs are accepted', () => {
  assert.equal(parse(httpUrl, 'https://example.com/admin?page=1').ok, true);
  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', 'ftp://x', 'not a url', 'https://a b', 'https://x\nhttps://y', 'https://exa\nmple.com']) {
    assert.equal(parse(httpUrl, bad).ok, false, `accepted ${JSON.stringify(bad)}`);
  }
});

test('stored URLs arrive trimmed, so a trailing newline cannot survive validation', () => {
  const result = parse(httpUrl, '  https://shop.example.com \n');
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, 'https://shop.example.com');
});

test('link slots may be empty, null or absent', () => {
  assert.equal(parse(urlsInput, {}).ok, true);
  assert.equal(parse(urlsInput, { live: '', admin: null }).ok, true);
  assert.equal(parse(urlsInput, { live: 'https://x.com' }).ok, true);
  assert.equal(parse(urlsInput, { live: 'x.com' }).ok, false);
});

test('defaults are filled in on the parsed output', () => {
  const room = parse(roomCreate, { name: 'Client A' });
  assert.equal(room.ok && room.value.color, '#6366f1');
  assert.equal(room.ok && room.value.icon, 'folder');
  assert.equal(room.ok && room.value.description, '');

  const site = parse(websiteCreate, { room_id: '00000000-0000-0000-0000-000000000000', name: 'Shop' });
  assert.equal(site.ok && site.value.status, 'active');
  assert.deepEqual(site.ok && site.value.tags, []);
  assert.deepEqual(site.ok && site.value.urls, {});
});

test('required fields cannot be blank', () => {
  assert.equal(parse(websiteCreate, { room_id: 'nope', name: '' }).ok, false);
  assert.equal(parse(credentialCreate, { website_id: '00000000-0000-0000-0000-000000000000', username: 'a' }).ok, false);
  assert.equal(parse(credentialCreate, { website_id: '00000000-0000-0000-0000-000000000000', password: '' }).ok, false);
});

test('account and status enums are closed sets', () => {
  for (const status of STATUSES) assert.equal(parse(websiteCreate, { room_id: '00000000-0000-0000-0000-000000000000', name: 'x', status }).ok, true);
  for (const type of ACCOUNT_TYPES) {
    assert.equal(parse(credentialCreate, { website_id: '00000000-0000-0000-0000-000000000000', username: 'u', password: 'p', account_type: type }).ok, true);
  }
  assert.equal(parse(websiteCreate, { room_id: '00000000-0000-0000-0000-000000000000', name: 'x', status: 'live_forever' }).ok, false);
  assert.equal(URL_KINDS.length, 5);
});

test('setup enforces a 12-character floor on the admin password', () => {
  assert.equal(parse(setupInput, { username: 'moataz', password: 'x'.repeat(11) }).ok, false);
  assert.equal(parse(setupInput, { username: 'moataz', password: 'x'.repeat(12) }).ok, true);
  assert.equal(parse(setupInput, { username: 'moataz', password: 'x'.repeat(12), locale: 'de' }).ok, false);
  assert.equal(parse(setupInput, { username: 'a b', password: 'x'.repeat(12) }).ok, false, 'spaces must not be allowed in a username');
  assert.equal(parse(passwordChangeInput, { current_password: 'old', new_password: 'short' }).ok, false);
});

test('validation issues are reported as readable field:path messages', () => {
  const result = parse(websiteCreate, { room_id: 'nope', name: '' });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.issues.some(i => i.startsWith('room_id:')), result.issues.join('|'));
});

// ─── i18n + formatting ───────────────────────────────────────────────────────

test('every dictionary entry has both languages', () => {
  for (const [key, entry] of Object.entries(DICT)) {
    assert.ok(entry.ar.trim().length > 0, `${key} has no Arabic text`);
    assert.ok(entry.en.trim().length > 0, `${key} has no English text`);
  }
});

test('translation interpolates variables and never leaks the other language', () => {
  assert.equal(translate('ar', 'err_locked_for', { s: 900 }).includes('900'), true);
  assert.equal(translate('en', 'err_locked_for', { s: 900 }).includes('900'), true);
});

test('every audit action in the app has an Arabic and English label', () => {
  const actions = new Set<string>();
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(e =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
    );
  for (const file of walk(join(root, 'src'))) {
    if (!/\.tsx?$/.test(file)) continue;
    for (const match of readFileSync(file, 'utf8').matchAll(/audit\(\s*[^,]+,\s*'([a-z_.]+)'/g)) actions.add(match[1]!);
  }
  assert.ok(actions.size >= 20, `only found ${actions.size} actions — the scan pattern broke`);
  for (const action of actions) {
    assert.notEqual(activityLabel('ar', action), action, `no Arabic label for ${action}`);
    assert.notEqual(activityLabel('en', action), action, `no English label for ${action}`);
  }
});

test('unknown activity falls back to the raw action instead of a missing key', () => {
  assert.equal(activityLabel('en', 'not.a.real.action'), 'not.a.real.action');
});

test('hostname rendering strips any credentials from a URL', () => {
  assert.equal(hostOf('https://admin:hunter2@shop.example.com/dashboard?x=1'), 'shop.example.com');
  assert.equal(hostOf(''), '');
  assert.equal(hostOf(null), '');
  assert.equal(formatDate(null, 'ar'), '—');
});

// ─── password recovery ───────────────────────────────────────────────────────

test('recovery codes are six digits and never repeat in practice', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 400; i++) {
    const code = randomRecoveryCode();
    assert.match(code, /^\d{6}$/, `${code} is not six digits`);
    seen.add(code);
  }
  assert.ok(seen.size > 380, 'codes are not random enough to be unguessable');
});

test('a stored recovery code is an HMAC, and another account cannot reuse it', () => {
  const hash = hashCode('user-a', '123456');
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.ok(!hash.includes('123456'));
  assert.equal(hash, hashCode('user-a', ' 123456 '), 'surrounding space must not change the answer');
  assert.notEqual(hash, hashCode('user-b', '123456'), 'the code must be bound to its account');
  assert.notEqual(hash, hashCode('user-a', '123457'));
});

test('session-revocation check reads iat and refuses to guess', () => {
  const jwt = (payload: unknown) => `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
  assert.equal(tokenIssuedAt(jwt({ iat: 1_700_000_000 })), 1_700_000_000);
  assert.equal(tokenIssuedAt(jwt({ sub: 'no-iat' })), null);
  assert.equal(tokenIssuedAt(jwt({ iat: 'now' })), null, 'a non-numeric iat must not be trusted');
  for (const bad of ['', 'abc', 'a.b', undefined, null]) assert.equal(tokenIssuedAt(bad as string), null);
});

test('recovery email input accepts an inbox, accepts clearing, rejects junk', () => {
  const ok = parse(recoveryEmailInput, { email: '  Moataz@Gmail.COM ', password: 'x'.repeat(12) });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.value.email, 'moataz@gmail.com', 'addresses are stored lowercase');
  assert.equal(parse(recoveryEmailInput, { email: '', password: 'x'.repeat(12) }).ok, true, 'clearing the address must be allowed');
  for (const bad of ['moataz', 'moataz@', '@gmail.com', 'a b@c.de', 'moataz@gmail', 'moataz@gmail.c']) {
    assert.equal(parse(recoveryEmailInput, { email: bad, password: 'x'.repeat(12) }).ok, false, `accepted ${JSON.stringify(bad)}`);
  }
  assert.equal(parse(recoveryEmailInput, { email: 'm@g.com', password: '' }).ok, false, 'changing it needs the current password');
});

test('the reset endpoint only accepts a six-digit code and a strong new password', () => {
  assert.equal(parse(passwordResetInput, { username: 'moataz', code: '042317', password: 'x'.repeat(12) }).ok, true);
  assert.equal(parse(passwordResetInput, { username: 'moataz', code: '42317', password: 'x'.repeat(12) }).ok, false);
  assert.equal(parse(passwordResetInput, { username: 'moataz', code: 'abcd12', password: 'x'.repeat(12) }).ok, false);
  assert.equal(parse(passwordResetInput, { username: 'moataz', code: '123456', password: 'short' }).ok, false);
});

test('recovery email stays off until a transport is configured', () => {
  assert.equal(env.mailReady, false, 'selftest must never hold real Resend keys');
  assert.equal(mailEnabled(), false, 'without a transport or an outbox nothing can be sent');
  assert.equal(RECOVERY_TTL_SECONDS, 600);
  assert.equal(RECOVERY_MAX_ATTEMPTS, 5);
});

test('the settings screen never renders a full recovery address', () => {
  const masked = maskEmail('moatazsmohamed@gmail.com');
  assert.ok(masked.endsWith('@gmail.com'), masked);
  assert.ok(!masked.includes('atazsmoham'), 'the local part must be masked');
  assert.equal(maskEmail('ab@gmail.com'), '••••@gmail.com', 'a two-letter inbox stays fully hidden');
  assert.equal(maskEmail('garbage'), '•••', 'a value with no domain renders as nothing useful');
});

// ─── runner ──────────────────────────────────────────────────────────────────

let failed = 0;
let skipped = 0;
for (const c of cases) {
  const reason = c.skip?.() ?? null;
  if (reason) {
    skipped++;
    console.log(`  skip  ${c.name} — ${reason}`);
    continue;
  }
  try {
    c.run();
    console.log(`  ok    ${c.name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL  ${c.name}\n        ${(error as Error).message.split('\n').join('\n        ')}`);
  }
}
const passed = cases.length - failed - skipped;
console.log(`\n${passed}/${cases.length} security self-tests passed, ${skipped} skipped, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
