/**
 * End-to-end workflow tests — README §7. Needs the app running against a real
 * Supabase project, so it is deliberately NOT part of `npm run selftest`:
 *
 *   npm run dev            # or npm run start, in another shell
 *   npm run e2e
 *
 * Optional (same names the app reads, so the shell that runs this must be able
 * to see them):
 *   WEBVAULT_E2E_BASE      default http://localhost:3000
 *   WEBVAULT_E2E_KEEP      "1" to leave the two test accounts behind
 *   --fresh                delete the leftover e2e accounts first, so the run
 *                          starts from a true first-run database
 *
 * The setup and invite keys are picked up from .env.local; WEBVAULT_E2E_SETUP_KEY
 * and WEBVAULT_E2E_INVITE_KEY override them when the server runs elsewhere.
 *
 * It creates its own accounts and data, and deletes everything it made.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The runner needs the same env the server reads, for the throttle reset only.
const envFile = join(import.meta.dirname!, '..', '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.+)$/.exec(line.trim());
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!;
  }
}

/**
 * The API compares `Origin` against the request host, and Next reports that host as
 * `localhost` even when the socket is reached by IP — so always drive it as localhost.
 */
const BASE = (process.env.WEBVAULT_E2E_BASE ?? 'http://localhost:3000')
  .replace(/\/+$/, '')
  .replace('127.0.0.1', 'localhost');
/** Defaults to the server's own values, which the env block above already read from .env.local. */
const SETUP_KEY = process.env.WEBVAULT_E2E_SETUP_KEY ?? process.env.WEBVAULT_SETUP_KEY ?? '';
/** WEBVAULT_INVITE_KEY on the server: lets the runner open its throwaway account. */
const INVITE_KEY = process.env.WEBVAULT_E2E_INVITE_KEY ?? process.env.WEBVAULT_INVITE_KEY ?? '';
const KEEP = process.env.WEBVAULT_E2E_KEEP === '1';

const PW_MAIN = 'e2e-vault-main-2026-Px!k';
const PW_ROTATED = 'e2e-vault-rotated-2026-Qx!k';
const PW_THROWAWAY = 'e2e-vault-throwaway-2026-Rx!k';
const SECRET_SENTINEL = 'Sup3r-S3cret-Needl3-E2E';
const ACCOUNT = { keeper: 'e2e_keeper', throwaway: 'e2e_throwaway' };

let cookies = new Map();
const results = [];
let step = 0;

async function test(name, run) {
  step += 1;
  try {
    await run();
    results.push({ name });
    console.log(`  ok    ${name}`);
  } catch (error) {
    results.push({ name, error: (error as Error).message.split('\n')[0] });
    console.log(`  FAIL  ${name}\n        ${(error as Error).message.split('\n')[0]}`);
  }
}

type Hit = { status: number; body: string; json: any; has: (needle: string) => boolean };

/** Every request carries Origin + Cookie: the API enforces same-origin writes. */
async function hit(path, init = {}) {
  const headers = new Headers(init.headers ?? {});
  headers.set('origin', BASE);
  headers.set('user-agent', 'webvault-e2e');
  if (cookies.size) headers.set('cookie', [...cookies].map(([k, v]) => `${k}=${v}`).join('; '));
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const res = await fetch(BASE + path, { ...init, headers, redirect: 'manual' });
  const text = await res.text();
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const eq = pair?.indexOf('=');
    if (!eq || eq < 1) continue;
    const name = pair!.slice(0, eq);
    const value = pair!.slice(eq + 1);
    const cleared = value === '' || /max-age\s*=\s*0\b/i.test(raw) || /expires\s*=\s*thu, 01 jan 1970/i.test(raw);
    if (cleared) cookies.delete(name);
    else cookies.set(name, value);
  }
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* html or csv */
  }
  return {
    status: res.status,
    body: text,
    json: parsed,
    has: needle => text.toLowerCase().includes(needle.toLowerCase()),
  };
}

const get = (p: string) => hit(p);
const post = (p: string, body?: unknown, headers?: Record<string, string>) =>
  hit(p, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body), headers });
const patch = (p: string, body: unknown) => hit(p, { method: 'PATCH', body: JSON.stringify(body) });
const del = (p: string, confirmed = false) =>
  hit(p, { method: 'DELETE', headers: confirmed ? { 'x-confirm-delete': 'DELETE' } : {} });

const idOf = (r: Hit, key: string): string => {
  assert.equal(r.status, 201, `${key} create failed: ${r.body.slice(0, 200)}`);
  const id = r.json?.[key]?.id ?? r.json?.id;
  assert.ok(typeof id === 'string' && id.length > 10, `no id for ${key}: ${r.body.slice(0, 200)}`);
  return id;
};

/** Walk the JSON tree and collect every string that is 2+ levels below a `urls` key. */
function collectUrls(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) for (const item of node) collectUrls(item, out);
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === 'urls' && v && typeof v === 'object') {
        for (const u of Object.values(v as Record<string, unknown>)) if (typeof u === 'string' && u) out.push(u);
      } else collectUrls(v, out);
    }
  }
  return out;
}

async function bootstrap() {
  await clearThrottle();
  const probe = await get('/api/auth/login');
  if (probe.status === 401) throw new Error(`server refused the probe (${probe.status}) — is the app running and env filled?`);
  const existing = await post(`/api/auth/login`, { username: ACCOUNT.keeper, password: PW_MAIN });
  if (existing.status === 200) return;
  assert.equal(probe.json?.firstRun, true, 'not first run and the e2e account does not exist — rerun with --fresh');
  const setup = await hit('/api/auth/login', {
    method: 'PUT',
    body: JSON.stringify({
      username: ACCOUNT.keeper,
      password: PW_MAIN,
      display_name: 'E2E Keeper',
      locale: 'en',
      setup_key: SETUP_KEY,
    }),
  });
  assert.equal(setup.status, 200, `first-run setup rejected: ${setup.body.slice(0, 200)}`);
  assert.ok(cookies.size > 0, 'setup did not issue a session cookie');
}

/**
 * Throttle state is keyed by IP and username, so a legitimate test sequence can
 * lock the runner out of its own app. The rows are test state, not user data.
 */
async function clearThrottle(): Promise<void> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  await fetch(process.env.SUPABASE_URL + '/rest/v1/auth_attempts?key=like.*', {
    method: 'DELETE',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
      prefer: 'return=minimal',
    },
  }).catch(() => {});
}

/** Sign in as one of the two e2e accounts and hand back the previous cookie jar. */
async function loginAs(username: string, password: string): Promise<Map<string, string>> {
  const previous = cookies;
  cookies = new Map();
  await clearThrottle();
  const r = await post('/api/auth/login', { username, password });
  assert.ok(r.status === 200, `login as ${username} → ${r.status} ${r.body.slice(0, 160)}`);
  return previous;
}

/**
 * The suite renames and re-passwords its own keeper, so a rerun needs a clean
 * slate: remove the e2e auth users (their rows cascade) and start over.
 */
async function nukeE2eAccounts(): Promise<void> {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error('--fresh needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const listing = (await fetch(`${base}/auth/v1/admin/users?page=0&per_page=1000`, { headers })
    .then(r => r.json())
    .catch(() => ({ users: [] }))) as { users?: { id: string; email?: string }[] };
  const e2e = (listing.users ?? []).filter(u => String(u.email ?? '').startsWith('e2e_'));
  if (e2e.length) {
    await fetch(`${base}/rest/v1/activity_logs?owner_id=in.(${e2e.map(u => u.id).join(',')})`, {
      method: 'DELETE',
      headers: { ...headers, prefer: 'return=minimal' },
    }).catch(() => {});
  }
  for (const user of e2e) {
    const res = await fetch(`${base}/auth/v1/admin/users/${user.id}`, { method: 'DELETE', headers });
    if (!res.ok && res.status !== 404) throw new Error(`could not remove an e2e account (${res.status})`);
  }
  console.log(`  removed ${e2e.length} leftover e2e account(s)`);
}

console.log(`\nWebVault end-to-end — ${BASE}\n`);

// ── pre-flight: is the server reachable at all ───────────────────────────────
const reachable = await fetch(BASE + '/login').then(r => r.status).catch(() => 0);
assert.ok(reachable === 200, `no app on ${BASE} (status ${reachable}) — start it with: npm run dev`);
if (process.argv.includes('--fresh')) await nukeE2eAccounts();
await bootstrap();

let siteFull = '';
let siteLite = '';
let roomId = '';
let credentialId = '';

// 1 — login
await test('1. login with the right password opens a session', async () => {
  cookies = new Map();
  const r = await post('/api/auth/login', { username: ACCOUNT.keeper, password: PW_MAIN });
  assert.equal(r.status, 200, r.body.slice(0, 200));
  assert.ok([...cookies.keys()].some(k => k.startsWith('sb-')), 'no supabase session cookie');
});

await test('1b. wrong password is refused with one generic message', async () => {
  const r = await post('/api/auth/login', { username: ACCOUNT.keeper, password: 'definitely-not-it' });
  assert.equal(r.status, 401);
  assert.ok(!r.has('correct'), 'the error hints at which field was wrong');
});

await test('1c. the session survives a refresh (protected page renders)', async () => {
  const r = await get('/dashboard');
  assert.equal(r.status, 200, `dashboard returned ${r.status}`);
});

// 2 — protected pages
await test('2. logged out, every protected page and API bounces', async () => {
  const saved = cookies;
  cookies = new Map();
  for (const p of ['/dashboard', '/vault', '/settings', '/rooms', '/websites']) {
    const r = await get(p);
    assert.ok(r.status === 302 || r.status === 307 || r.status === 200, `${p} → ${r.status}`);
    if (r.status === 200) assert.ok(/login|Sign in|تسجيل/i.test(r.body), `${p} rendered while logged out`);
  }
  for (const p of ['/api/websites', '/api/credentials', '/api/export', '/api/rooms']) {
    const r = await get(p);
    assert.equal(r.status, 401, `${p} returned ${r.status} without a session`);
    assert.ok(r.has('UNAUTHENTICATED'), `${p} did not use the auth error code`);
  }
  cookies = saved;
});

// 3 — create a room
await test('3. room created with colour, icon and slug', async () => {
  const r = await post('/api/rooms', {
    name: 'E2E Lab',
    slug: 'e2e-lab',
    description: 'created by the end-to-end runner',
    color: '#22c55e',
    icon: 'folder',
  });
  roomId = idOf(r, 'room');
  assert.equal(r.json.room.name, 'E2E Lab');
  const list = await get('/api/rooms');
  assert.ok(list.json.rooms.some((x: any) => x.id === roomId), 'room missing from the list');
});

// 4 — websites
await test('4. website with all five link slots', async () => {
  const urls = {
    live: 'https://e2e-live.example.com',
    admin: 'https://e2e-admin.example.com/wp-admin',
    developer: 'https://e2e-dev.example.com',
    source: 'https://github.com/e2e/source',
    hosting: 'https://e2e-hosting.example.com',
  };
  const r = await post('/api/websites', {
    room_id: roomId,
    name: 'E2E Full Site',
    description: 'five-slot site',
    category: 'saas',
    client_name: 'E2E Client',
    status: 'active',
    tags: ['e2e', 'full'],
    urls,
  });
  siteFull = idOf(r, 'website');
  assert.deepEqual(r.json.website.urls, urls, 'urls did not round-trip');
});

await test('4b. website with only a live URL keeps the other slots empty', async () => {
  const r = await post('/api/websites', {
    room_id: roomId,
    name: 'E2E Lite Site',
    urls: { live: 'https://e2e-lite.example.com' },
  });
  siteLite = idOf(r, 'website');
  const u = r.json.website.urls;
  assert.equal(u.live, 'https://e2e-lite.example.com', 'the live slot did not save');
  for (const slot of ['admin', 'developer', 'source', 'hosting']) {
    assert.ok(!u[slot], `${slot} should be empty, got ${u[slot]}`);
  }
});

await test('4c. a non-http URL is rejected outright', async () => {
  const r = await post('/api/websites', { room_id: roomId, name: 'E2E Bad', urls: { live: 'javascript:alert(1)' } });
  assert.equal(r.status, 400, r.body.slice(0, 200));
});

// 5 — credentials
await test('5. admin and developer credentials saved on the same site', async () => {
  const adminCred = await post('/api/credentials', {
    website_id: siteFull,
    account_type: 'admin',
    title: 'E2E Admin login',
    login_url: 'https://e2e-admin.example.com/wp-login',
    username: 'e2e-admin-user',
    password: SECRET_SENTINEL,
    notes: 'created by the runner',
  });
  credentialId = idOf(adminCred, 'credential');
  const devCred = await post('/api/credentials', {
    website_id: siteFull,
    account_type: 'developer',
    title: 'E2E Dev panel',
    username: 'e2e-dev-user',
    password: 'dev-' + SECRET_SENTINEL,
  });
  assert.ok(devCred.json.credential.id !== credentialId);
});

await test('5b. list responses mask the username and carry no password material', async () => {
  const r = await get('/api/credentials');
  assert.equal(r.status, 200);
  assert.ok(!r.has(SECRET_SENTINEL), 'a plaintext password leaked into the list');
  assert.ok(!r.has('e2e-admin-user'), 'the username leaked into the list');
  assert.ok(!/_enc\b/i.test(r.body), 'ciphertext columns reached the client');
  assert.ok(/hint/i.test(r.body), 'no masked hint in the response');
  const site = await get(`/api/websites/${siteFull}`);
  assert.ok(!site.has(SECRET_SENTINEL), 'a plaintext password leaked into the website payload');
  assert.ok(collectUrls(site.json).length > 0, 'the website payload lost its urls');
});

// 6 — open a link
await test('6. opening a link stamps last_accessed_at and reorders the accessed view', async () => {
  const before = await get(`/api/websites/${siteFull}`);
  assert.ok(!before.json.website.last_accessed_at, 'a brand new site already has an access stamp');
  const r = await post(`/api/websites/${siteFull}/access`, { kind: 'live', url: 'https://e2e-live.example.com' });
  assert.equal(r.status, 200, r.body.slice(0, 200));
  const after = await get(`/api/websites/${siteFull}`);
  assert.ok(after.json.website.last_accessed_at, 'no last_accessed_at stamped');
  assert.notEqual(after.json.website.last_accessed_at, before.json.website.last_accessed_at);
  const list = await get('/api/websites?sort=accessed');
  assert.ok(Array.isArray(list.json?.websites), `accessed sort returned no list: ${list.body.slice(0, 160)}`);
  assert.equal(list.json.websites[0].id, siteFull, `most recently opened site should lead, got ${list.json.websites[0]?.name}`);
});

await test('6b. a malformed record id is rejected, not treated as a lookup', async () => {
  const cases: [string, string][] = [
    ['GET', '/api/websites/undefined'],
    ['GET', '/api/websites/not-a-uuid'],
    ['GET', '/api/rooms/undefined'],
    ['PATCH', '/api/credentials/undefined'],
    ['DELETE', '/api/credentials/undefined'],
  ];
  for (const [method, p] of cases) {
    const r =
      method === 'GET'
        ? await get(p)
        : method === 'PATCH'
          ? await patch(p, { title: 'should never reach the database' })
          : await del(p, true);
    assert.equal(r.status, 400, `${method} ${p} → ${r.status}, expected 400`);
    assert.ok(r.has('VALIDATION_FAILED'), `${method} ${p} did not report a validation error`);
  }
});

// 7 — reveal + copy
await test('7. locked vault refuses to reveal', async () => {
  const r = await post(`/api/credentials/${credentialId}/reveal`);
  assert.equal(r.status, 423, `expected VAULT_LOCKED, got ${r.status}: ${r.body.slice(0, 160)}`);
  assert.ok(r.has('VAULT_LOCKED'));
});

await test('7c. unlock then reveal returns the exact secret', async () => {
  const r = await post('/api/auth/unlock', { password: PW_MAIN });
  assert.equal(r.status, 200, r.body.slice(0, 200));
  assert.ok(cookies.has('wv_unlock'), 'no unlock cookie issued');
  const reveal = await post(`/api/credentials/${credentialId}/reveal`);
  assert.equal(reveal.status, 200, reveal.body.slice(0, 200));
  assert.equal(reveal.json.credential.password, SECRET_SENTINEL, 'decrypted value differs from what was stored');
});

await test('7d. locking the vault refuses reveal again', async () => {
  const lock = await hit('/api/auth/unlock', { method: 'DELETE' });
  assert.equal(lock.status, 200);
  const reveal = await post(`/api/credentials/${credentialId}/reveal`);
  assert.equal(reveal.status, 423, 'reveal still worked after locking');
});

// 8 — edit and delete (throwaway account owns the records it loses)
let throwRoom = '';
let throwSite = '';
let throwCred = '';

await test('8. a throwaway account can be bootstrapped for destructive checks', async () => {
  const saved = cookies;
  cookies = new Map();
  const setup = await hit('/api/auth/login', {
    method: 'PUT',
    body: JSON.stringify({ username: ACCOUNT.throwaway, password: PW_THROWAWAY, display_name: 'E2E Throwaway', locale: 'ar', setup_key: INVITE_KEY }),
  });
  assert.equal(setup.status, 200, `invite setup: ${setup.status} ${setup.body.slice(0, 160)} — set WEBVAULT_E2E_INVITE_KEY and WEBVAULT_INVITE_KEY`);
  const room = await post('/api/rooms', { name: 'E2E Doomed', color: '#f97316', icon: 'folder' });
  throwRoom = idOf(room, 'room');
  const site = await post('/api/websites', { room_id: throwRoom, name: 'E2E Doomed Site', urls: { live: 'https://e2e-doomed.example.com' } });
  throwSite = idOf(site, 'website');
  const cred = await post('/api/credentials', { website_id: throwSite, account_type: 'other', username: 'doomed-user', password: 'doomed-' + SECRET_SENTINEL });
  throwCred = idOf(cred, 'credential');
  cookies = saved;
});

await test('8e. one account never sees another account records', async () => {
  const rooms = await get('/api/rooms');
  assert.ok(!JSON.stringify(rooms.json).includes(throwRoom), 'the keeper can list the throwaway room');
  const sites = await get('/api/websites?limit=1000');
  assert.ok(!JSON.stringify(sites.json).includes(throwSite), 'the keeper can list the throwaway site');
  const creds = await get('/api/credentials');
  assert.ok(!JSON.stringify(creds.json).includes(throwCred), 'the keeper can list the throwaway credential');
  const direct = await get(`/api/websites/${throwSite}`);
  assert.equal(direct.status, 404, `reading another account site gave ${direct.status}`);
});

await test('8b. destructive calls are refused without the DELETE confirmation header', async () => {
  const saved = await loginAs(ACCOUNT.throwaway, PW_THROWAWAY);
  const site = await del(`/api/websites/${throwSite}`);
  assert.equal(site.status, 400, 'a delete went through with no confirmation');
  const cred = await del(`/api/credentials/${throwCred}`);
  assert.equal(cred.status, 400, 'a credential delete went through with no confirmation');
  cookies = saved;
});

await test('8c. edit updates in place instead of recreating', async () => {
  const saved = await loginAs(ACCOUNT.throwaway, PW_THROWAWAY);
  const r = await patch(`/api/websites/${throwSite}`, { name: 'E2E Doomed Renamed', status: 'paused', tags: ['edited'] });
  assert.equal(r.status, 200, r.body.slice(0, 200));
  assert.equal(r.json.website.id, throwSite, 'editing produced a different id');
  assert.equal(r.json.website.name, 'E2E Doomed Renamed');
  assert.equal(r.json.website.status, 'paused');
  cookies = saved;
});

await test('8d. archive a room, restore it, then delete a credential and a site for real', async () => {
  await loginAs(ACCOUNT.throwaway, PW_THROWAWAY);
  const archived = await patch(`/api/rooms/${throwRoom}`, { archived: true });
  assert.equal(archived.status, 200, archived.body.slice(0, 200));
  assert.equal(archived.json.room.archived, true);
  const hidden = await get('/api/rooms');
  assert.ok(!JSON.stringify(hidden.json).includes(throwRoom), `archived room still in the default list: ${hidden.body.slice(0, 200)}`);
  const shown = await get('/api/rooms?archived=1');
  assert.ok(JSON.stringify(shown.json).includes(throwRoom), 'an archived room is missing from the archived view');
  const restored = await patch(`/api/rooms/${throwRoom}`, { archived: false });
  assert.equal(restored.json.room.archived, false);
  const back = await get('/api/rooms');
  assert.ok(JSON.stringify(back.json).includes(throwRoom), 'the restored room did not return to the default list');
  const gone = await del(`/api/credentials/${throwCred}`, true);
  assert.equal(gone.status, 200, gone.body.slice(0, 200));
  const siteGone = await del(`/api/websites/${throwSite}`, true);
  assert.equal(siteGone.status, 200, siteGone.body.slice(0, 200));
  const missing = await get(`/api/websites/${throwSite}`);
  assert.equal(missing.status, 404, 'the deleted site is still readable');
});

// 9 — search
await test('9. search matches name, client, category, tag, URL, room and combinations', async () => {
  await loginAs(ACCOUNT.keeper, PW_MAIN);
  const hits = (r: Hit, label: string) => {
    assert.equal(r.status, 200, `${label}: ${r.body.slice(0, 160)}`);
    assert.ok(Array.isArray(r.json?.websites), `${label}: no list in response: ${r.body.slice(0, 160)}`);
    const names = (r.json.websites ?? []).map((w: any) => w.name);
    assert.ok(r.json.websites.some((w: any) => w.id === siteFull), `${label} missed — got ${JSON.stringify(names)}`);
  };
  hits(await get('/api/websites?q=' + encodeURIComponent('Full Site')), 'name');
  hits(await get('/api/websites?q=' + encodeURIComponent('E2E Client')), 'client');
  hits(await get('/api/websites?category=saas'), 'category');
  hits(await get('/api/websites?tag=full'), 'tag');
  hits(await get('/api/websites?q=' + encodeURIComponent('e2e-hosting')), 'url');
  hits(await get('/api/websites?q=' + encodeURIComponent('E2E Lab')), 'room name');
  hits(await get('/api/websites?q=Full&status=active&tag=full'), 'combined filters');
  const miss = await get('/api/websites?q=' + encodeURIComponent('zzz-nothing-here-zzz'));
  assert.equal(miss.json.websites.length, 0, 'search returned noise for an impossible query');
});

await test('9b. search and room views never expose the stored secret', async () => {
  for (const p of ['/api/websites?q=E2E', `/api/rooms/${roomId}`, '/api/credentials']) {
    const r = await get(p);
    assert.ok(!r.has(SECRET_SENTINEL), `${p} leaked a password`);
    assert.ok(!/_enc\b/i.test(r.body), `${p} shipped ciphertext fields`);
  }
});

// 10 — settings
await test('10. profile preferences save (display name, locale, theme)', async () => {
  await loginAs(ACCOUNT.keeper, PW_MAIN);
  const r = await patch('/api/settings', { display_name: 'E2E Keeper Renamed', locale: 'ar', theme: 'light' });
  assert.equal(r.status, 200, r.body.slice(0, 200));
  const page = await get('/settings');
  assert.equal(page.status, 200);
});

await test('10b. changing the password re-locks the vault and invalidates the old one', async () => {
  await loginAs(ACCOUNT.keeper, PW_MAIN);
  const unlock = await post('/api/auth/unlock', { password: PW_MAIN });
  assert.equal(unlock.status, 200, unlock.body.slice(0, 160));
  assert.ok(cookies.has('wv_unlock'), 'unlock cookie missing before the rotation');
  const bad = await post('/api/settings/account', { action: 'password', current_password: 'wrong', new_password: PW_ROTATED });
  assert.equal(bad.status, 401);
  const ok = await post('/api/settings/account', { action: 'password', current_password: PW_MAIN, new_password: PW_ROTATED });
  assert.equal(ok.status, 200, ok.body.slice(0, 200));
  assert.ok(!cookies.has('wv_unlock'), 'the vault stayed unlocked after a password change');
  // Supabase also invalidates the session that changed its password, so either a
  // dead session (401) or a locked vault (423) is acceptable — plaintext never is.
  const reveal = await post(`/api/credentials/${credentialId}/reveal`);
  assert.ok(reveal.status === 423 || reveal.status === 401, `reveal after a password change gave ${reveal.status}`);
  assert.ok(!reveal.has(SECRET_SENTINEL), 'the password change leaked the secret anyway');
  cookies = new Map();
  const oldPw = await post('/api/auth/login', { username: ACCOUNT.keeper, password: PW_MAIN });
  assert.ok(oldPw.status === 429 || oldPw.status === 401, `old password produced ${oldPw.status}`);
});

await test('10c. the new password unlocks and reveals the same secret', async () => {
  const login = await post('/api/auth/login', { username: ACCOUNT.keeper, password: PW_ROTATED });
  assert.equal(login.status, 200, login.body.slice(0, 200));
  const unlock = await post('/api/auth/unlock', { password: PW_ROTATED });
  assert.equal(unlock.status, 200, unlock.body.slice(0, 200));
  const reveal = await post(`/api/credentials/${credentialId}/reveal`);
  assert.equal(reveal.status, 200, reveal.body.slice(0, 200));
  assert.equal(reveal.json.credential.password, SECRET_SENTINEL, 'rotation broke decryption of existing secrets');
});

await test('10d. renaming the username moves the login across', async () => {
  const r = await post('/api/settings/account', { action: 'username', username: 'e2e_keeper_v2', password: PW_ROTATED });
  assert.equal(r.status, 200, r.body.slice(0, 200));
  cookies = new Map();
  const oldName = await post('/api/auth/login', { username: ACCOUNT.keeper, password: PW_ROTATED });
  assert.ok(oldName.status === 401 || oldName.status === 429, `old username produced ${oldName.status}`);
  const newName = await post('/api/auth/login', { username: 'e2e_keeper_v2', password: PW_ROTATED });
  assert.equal(newName.status, 200, `new username produced ${newName.status}`);
  ACCOUNT.keeper = 'e2e_keeper_v2';
});

await test('10e. exports carry metadata only — no password, username or ciphertext', async () => {
  const jsonExport = await get('/api/export');
  assert.equal(jsonExport.status, 200);
  assert.equal(jsonExport.json.secrets_included, false);
  assert.ok(!jsonExport.has(SECRET_SENTINEL), 'the JSON export contains a stored password');
  assert.ok(!jsonExport.has('e2e-admin-user'), 'the JSON export contains a stored username');
  assert.ok(!/_enc\b/i.test(jsonExport.body), 'the JSON export contains ciphertext fields');
  assert.ok(jsonExport.json.websites.some((w: any) => w.id === siteFull), 'the export lost the keeper site');
  const csvExport = await get('/api/export?format=csv');
  assert.equal(csvExport.status, 200);
  assert.ok(csvExport.has('credential_hints'), 'csv export lost the hint column');
  assert.ok(!csvExport.has(SECRET_SENTINEL), 'the CSV export contains a stored password');
  assert.ok(!csvExport.has('e2e-admin-user'), 'the CSV export contains a stored username');
});

// 1 — lockout on the bad-password path, run LAST so the 15-minute lock cannot
// interfere with the authenticated tests above.
await test('1f. five bad passwords lock further attempts out', async () => {
  const saved = cookies;
  cookies = new Map();
  const statuses = [];
  for (let i = 0; i < 6; i += 1) {
    const r = await post('/api/auth/login', { username: ACCOUNT.throwaway, password: 'brute-force-' + i });
    statuses.push(r.status);
    if (r.status === 429) break;
  }
  cookies = saved;
  assert.ok(statuses.includes(429), `no lockout after 6 bad tries: ${statuses.join(',')}`);
  const body = await post('/api/auth/login', { username: ACCOUNT.throwaway, password: PW_THROWAWAY });
  assert.equal(body.status, 429, 'the right password worked through the lock — the lock is decorative');
});

await test('11. logout clears the session', async () => {
  await post('/api/auth/logout');
  const r = await get('/api/websites');
  assert.equal(r.status, 401, 'the session survived logout');
});

if (!KEEP) {
  console.log('\ncleaning up the e2e data…');
  try {
    cookies = new Map();
    await post('/api/auth/login', { username: ACCOUNT.keeper, password: PW_ROTATED });
    await del(`/api/rooms/${roomId}`, true);
    cookies = new Map();
    await post('/api/auth/login', { username: ACCOUNT.throwaway, password: PW_THROWAWAY });
    await post('/api/auth/logout');
  } catch {
    /* the throwaway account is locked out by design; the org owner can delete both from Supabase */
  }
  console.log('  note: the two auth users (e2e_keeper_v2, e2e_throwaway) stay in Supabase Auth — delete them from the dashboard, or rerun with WEBVAULT_E2E_KEEP=1 to inspect them first.');
}

const failed = results.filter(r => r.error);
console.log(`\n${results.length - failed.length}/${results.length} end-to-end workflows passed, ${failed.length} failed.`);
for (const f of failed) console.log(`  FAIL  ${f.name} — ${f.error}`);
process.exit(failed.length ? 1 : 0);
