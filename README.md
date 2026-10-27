# WebVault — My Websites Management System

A private, single-owner dashboard for every website you build: rooms (clients/projects), websites with five
named link slots, and an **encrypted credentials vault**. Real database, real authentication, encrypted at
rest, bilingual (Arabic RTL / English LTR), dark and light themes.

Stack: **Next.js 15 (App Router) + TypeScript (strict) + Tailwind + Supabase Postgres + Supabase Auth**.
The browser never talks to Postgres. Every read and write goes through a server-side route that has already
verified who you are.

---

## 1. Architecture

```
Browser (React client components)
   │  fetch /api/*  (same-origin only, cookie session, never a DB key)
   ▼
Next.js route handlers  ── guard() ──► Supabase Auth: getUser()  ──► profiles row
   │                                     ▲
   │                                     │ service_role key (server env only)
   ▼                                     │
src/lib/db.ts  ──────────────────────  Supabase Postgres (RLS: deny-all)
   │
   ├── crypto.ts   AES-256-GCM envelope encryption + HMAC blind index + scrypt verifier
   └── audit       every mutating action → activity_logs (with a no-secrets CHECK in SQL)
```

Three layers have to agree before data moves:

1. **`guard()`** ([src/lib/api.ts:29](src/lib/api.ts#L29)) — identity comes from the verified Supabase session, never
   from the request body. Returns the profile and whether the vault is unlocked.
2. **Owner scoping** ([src/lib/db.ts](src/lib/db.ts)) — every query carries `eq('owner_id', profile.id)`; there is no
   "admin view" that reads another owner's rows, because there is only one owner.
3. **Row Level Security** ([supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql)) — enabled on every
   table with **no policies**, plus `revoke all … from anon, authenticated`. Even a leaked anon key, a stolen
   backup, or a direct REST call returns nothing. Only `service_role` can read, and that key lives in server env.

`src/middleware.ts` is **convenience, not the security boundary**: it refreshes the auth cookie and bounces
session-less requests early. Delete the file and every page still redirects (`requireProfile()`) and every API
still answers 401 (`guard()`).

### Layout

| Area | Files |
| --- | --- |
| Env validation (fails loudly at boot) | `src/lib/env.ts` |
| Crypto (vault, verifier, unlock token) | `src/lib/crypto.ts` |
| Supabase clients (server-side only) | `src/lib/supabase/server.ts` |
| Auth/session/profile + UI prefs | `src/lib/auth.ts` |
| All DB access | `src/lib/db.ts` |
| Zod input schemas | `src/lib/validation.ts` |
| HTTP helpers, CSRF gate, audit | `src/lib/api.ts` |
| i18n dictionary (server + client) | `src/lib/i18n.ts` |
| API routes | `src/app/api/**` (15 handlers) |
| Pages | `src/app/login`, `src/app/(app)/**` |
| Components | `src/components/**` |

---

## 2. Database schema

Enums: `url_kind` (`live|admin|developer|source|hosting`), `website_status`
(`active|development|paused|archived`), `credential_kind` (`admin|developer|client|other`).

| Table | Purpose | Notes |
| --- | --- | --- |
| `profiles` | app-side identity | `id` = Supabase `auth.users.id`, unique `username`, `locale`, `theme`, `reveal_salt`/`reveal_hash` (scrypt verifier) |
| `rooms` | project/client groupings | `slug` CHECK `^[a-z0-9][a-z0-9-]{1,60}$`, `icon` CHECK `^[a-z0-9_-]{1,32}$`, `color`, `archived_at` |
| `websites` | one site | status, category, client, description, notes, thumbnail, `last_accessed_at` |
| `website_urls` | the five link slots | unique `(website_id, kind)`, URL CHECK `^https?://…` — never stores credentials in the URL |
| `credentials` | the vault | `login_url`, `account_type`, `username_enc`, `password_enc`, `note_enc`, `username_idx` (blind index), `username_hint` (masked) |
| `tags` / `website_tags` | free tagging | unique label per owner |
| `activity_logs` | audit trail | action, entity, detail (jsonb), ip, user-agent + `log_no_secrets` CHECK |
| `auth_attempts` | throttling state | keyed counter with `locked_until` |

RPCs: `auth_take_attempt`, `auth_clear_attempt`, `auth_attempt_state`, `webvault_is_first_run`,
`webvault_room_stats` (site / dashboard / incomplete counts in one call), `touch_updated_at()` trigger.

Deleting is **soft**: rooms and websites set `archived_at`; you can restore from the UI. Hard delete only
happens from the explicit delete dialog, which requires typing `DELETE`, and it cascades the site's URLs and
credential rows.

---

## 3. Security model (what is actually implemented)

**Passwords** — never stored by this app. Supabase Auth stores its own Argon2/bcrypt hash; the service never
sees the plaintext. `profiles.reveal_salt/reveal_hash` hold a separate **scrypt** verifier
(N=32768, r=8, p=1, 64-byte output) used only for the "re-authenticate before reveal" step, compared with
`timingSafeEqual`.

**Credential vault** — AES-256-GCM, random 96-bit IV per record, stored as
`v1.<iv>.<tag>.<ciphertext>` (base64). GCM's auth tag means a tampered row fails decryption instead of
returning junk. Passwords/`username_idx` never appear in list queries, so no code path can accidentally ship
them to the client.

**Reveal gate** — four conditions, all required ([src/app/api/credentials/[id]/reveal/route.ts](src/app/api/credentials/[id]/reveal/route.ts)):
valid session → vault unlocked (fresh `wv_unlock` cookie) → row belongs to `owner_id` → rate limit clear
(**20 reveals / 10 min**, then the window locks). The unlock cookie is `httpOnly`, `SameSite=Strict`,
`Secure`, and expires in **5 minutes**; the UI re-masks after 60 s of viewing. Auto-lock is scheduled in-page.

**Login throttling** — **5 failures → 15-minute lock**, tracked separately per IP *and* per username, in
`auth_attempts` (DB-side, so it survives restarts and multi-instance deploys). Same message for "no such user"
and "wrong password" — no account enumeration.

**Session** — Supabase auth cookie, `httpOnly`, server-verified on every request; logout calls
`signOut()` and clears cookies. UI preference cookies (`wv_locale`, `wv_theme`) are not security-relevant.

**CSRF** — every mutating route calls `rejectCrossSite()` (Origin host must equal request host) and the session
cookie is `SameSite`, so a cross-site form or fetch cannot ride your session.

**XSS / injection** — React escapes all output; no `dangerouslySetInnerHTML`; CSP in
[next.config.ts:13](next.config.ts#L13) with `default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`,
`form-action 'self'`, `upgrade-insecure-requests`. Also `X-Frame-Options: DENY`, `X-Content-Type-Options`,
`Referrer-Policy: same-origin`, COOP/CORP `same-origin`, and HSTS (2 years, includeSubDomains, preload).
Postgres access is via the Supabase client with parameterised filters — no string SQL is ever built.

**Search results** are built from metadata columns only, so a search can never surface a password.

**Exports** ([/api/export](src/app/api/export/route.ts), JSON or CSV) contain project metadata + a credential
*count* + masked hints. The payload carries `secrets_included: false`, and no `*_enc` column is even selected.

**Logs** — `audit()` drops any key matching `password|secret|token|apikey|authorization|credential` before
inserting, and `activity_logs` has a matching CHECK constraint as a second net. Nothing is written to stdout.

**Env hygiene** — `WEBVAULT_ENC_KEY`, `WEBVAULT_SESSION_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` are read only
in modules marked `server-only`, so they cannot reach a client bundle. `env.ts` refuses to boot with a missing
or weak value (`assertEnv()` at the top of every handler).

### Threat model, plainly

| Threat | Status |
| --- | --- |
| Stolen DB dump / direct REST abuse | ciphertext + RLS deny-all + revoked grants |
| XSS in the dashboard | CSP + React escaping + `server-only` libs; tokens are httpOnly |
| CSRF | SameSite cookies + same-origin gate |
| Brute-force login | 5/15 min per IP **and** per username |
| Shoulder-surfing / always-on reveal | unlock expires in 5 min, reveal re-masks in 60 s, hint only until unlock |
| Bulk exfiltration of the vault | 20 reveals / 10 min + every reveal is audited |
| Leaked `.env` on a shared host | everything above except the enc key — **rotate** (see §6) |
| Owner's own device compromised | out of scope: the vault must be readable on the machine you unlock it from |
| Insider / second user | not supported — single owner by design |

Deploy it on HTTPS only (Vercel gives you this). Do not run the vault over plain HTTP.

---

## 4. Setup (first run, ~5 minutes)

### 4.1 Create the Supabase project
1. [supabase.com](https://supabase.com) → **New project** → name `webvault`, pick a strong DB password, region closest to you.
2. **Project Settings → API** — copy the **Project URL**, the **`service_role`** secret (anon key is not used).
3. **Authentication → Providers → Email**: leave enabled. **Turn OFF "Confirm email"** — accounts are created
   server-side with `email_confirm: true`, and a confirmation mail to the synthetic domain would never arrive.
4. **Authentication → Settings**: set "Enable RLS" default as you like — the migration hardens the tables itself.

### 4.2 Apply the schema
Open **SQL Editor**, paste the whole of `supabase/migrations/0001_init.sql`, press **Run**.
> The Supabase editor only executes the text you have *selected* — select all (Ctrl+A) first, or it runs a
> fragment and reports success.

It is idempotent (`if not exists` / `create or replace`), so re-running is safe.

### 4.3 Local environment
```bash
npm install
node scripts/gen-secrets.mjs   # prints the three secret values; copy them into .env.local
cp .env.example .env.local
```

`.env.local` (never committed — `.gitignore` covers it):

| Variable | Required | What it is |
| --- | --- | --- |
| `SUPABASE_URL` | yes | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | server-side only; bypasses RLS, so it is the one key to guard |
| `WEBVAULT_ENC_KEY` | yes | base64, decodes to exactly 32 bytes — AES-256 key for the vault |
| `WEBVAULT_SESSION_SECRET` | yes | ≥48 hex chars — HMAC for the 5-minute unlock cookie |
| `WEBVAULT_SETUP_KEY` | first run only | extra gate for the `/login` setup screen; clear it once your account exists |
| `NEXT_PUBLIC_APP_URL` | for prod | your public origin, used in export headers |

### 4.4 Run and create your account
```bash
npm run dev
```
Open <http://localhost:3000> — with no profile in the DB the login page becomes a **one-time setup form**
(username, password — minimum 12 characters, display name, language). Submitting it creates the Supabase Auth
user, writes your `profiles` row, signs you in, and **closes setup forever**. If `WEBVAULT_SETUP_KEY` is set,
that field is demanded too; unset it afterwards.

Logins use a **username**; internally it maps to the non-routable address
`<username>@vault.webvault.app`, so Supabase's email-based auth never needs a real inbox.

### 4.5 If something fails to boot

| Symptom | Cause |
| --- | --- |
| `Missing environment variables: …` on every page | `.env.local` is missing a value, or Vercel env vars were set after the deploy — redeploy |
| The login page never offers setup, and `PUT /api/auth/login` says "Setup is closed" | the migration never ran, so `webvault_is_first_run` fails and the app fails **closed** — re-run §4.2 |
| Sign-in says "Invalid credentials" with the right password | the profile row was deleted, or the username's case/spacing differs — usernames are stored lowercase |
| Reveal says "This record could not be decrypted with the current key" | `WEBVAULT_ENC_KEY` changed since the row was written — restore the old key or re-enter that credential |
| 429 on login | the 5-attempts lock is active; wait 15 minutes, or unlock from the SQL editor with `delete from auth_attempts where key like 'login:%';` |


---

## 5. Deploy (Vercel)

1. Push the repo to GitHub, **Import** it in Vercel (framework autodetects Next.js; Node 20+).
2. **Settings → Environment Variables** — add all six from §4.3 (`NEXT_PUBLIC_APP_URL=https://your-domain`).
3. Deploy. Then in Supabase → **Authentication → URL Configuration**, set **Site URL** to the same origin.
4. Open the deployment once to run the setup form, and clear `WEBVAULT_SETUP_KEY` right after.
5. Re-check: `curl -I https://your-domain/dashboard` should show the CSP, HSTS and `X-Frame-Options` headers.

Do not deploy `master` with a `.env` file inside the repo, and never paste the service-role key into a chat,
issue or screenshot.

---

## 6. Key rotation & backup

**Rotating `WEBVAULT_ENC_KEY`** — the stored envelope records its version, and `crypto.ts` only accepts version
1, so rotation is a re-encryption pass, not a swap:
1. Download a DB backup (below) and keep the **old** key somewhere safe.
2. Write a one-off script that reads every `credentials` row, `decrypt()`s with the old key, then
   `encrypt()`s with the new key and updates the row. Run it with the old key in the environment and the new
   key in a second variable.
3. Deploy with the new key and verify each credential still reveals.
4. Only then discard the old key. `blind_index` uses the same key, so usernames must be re-hashed in the pass.

Losing `WEBVAULT_ENC_KEY` makes stored passwords **unrecoverable** — there is no backdoor and no reset path.

**Backups**
- Supabase → Database → Backups (daily PITR on paid plans), or `pg_dump` the project on a schedule.
- The dump is safe *only* because the vault is encrypted and RLS denies anon access. Store dumps encrypted.
- `/api/export?format=json` (or `csv`) is the human backup: metadata + hints, no secrets. Keep it beside the
  repo, not in a public folder.

---

## 7. What to test after any change

1. **Login** — wrong password 5× → locked for 15 min; correct password → `/dashboard`; refresh keeps you in.
2. **Protected pages** — log out, then paste `/dashboard`, `/vault`, `/settings` and call `/api/websites` — all
   must bounce or return 401.
3. **Create a room** — name, colour, icon → card appears with counts.
4. **Add websites** — one with all five link slots, one with only a live URL.
5. **Save credentials** — an Admin record and a Developer record on the same site; only masked hints render.
6. **Open each link** — new tab, `noopener`, and the site shows up in "recently accessed".
7. **Reveal + copy** — locked vault refuses; unlock with your password; reveal shows the value, auto re-masks,
   then lock again and confirm the reveal is refused.
8. **Edit and delete** — edit a site without recreating it; delete a credential and a site with the `DELETE`
   confirmation; archive a room and restore it.
9. **Search** — by name, client, room, URL, category, tag, and combinations; results never contain a password.
10. **Settings** — change password (vault re-locks), change username (old one stops working, new one logs in),
    switch language/dir and theme, export JSON + CSV and grep the files for `password` — zero hits.

---

## 8. Commands

```bash
npm run dev         # local dev
npm run build       # production build
npm run start       # serve the build
npm run typecheck   # tsc --noEmit
npm run selftest    # 29 security tests, no database and no network needed
npm run e2e         # the §7 workflows against a running app + real database
```

`npm run e2e` ([scripts/e2e.mts](scripts/e2e.mts)) drives §7 end to end against a live server: it bootstraps its
own accounts, creates rooms/sites/credentials, then asserts the locked-vault refusal, unlock, reveal, re-lock,
archive/restore, delete confirmation, every search facet, password + username rotation, and that both export
formats stay secret-free. It cleans up after itself; the two auth users it creates stay in Supabase Auth (delete
them from the dashboard, or run with `WEBVAULT_E2E_KEEP=1` first). Point it elsewhere with `WEBVAULT_E2E_BASE`.

`npm run selftest` ([scripts/security-selftest.mts](scripts/security-selftest.mts)) runs the parts that must never
regress silently: the AES-GCM envelope (round-trip, fresh IV per write, tag tamper rejection, unknown key
version), the masked hint, the blind index, the scrypt verifier, the unlock token (expiry, wrong purpose,
tampered MAC), the audit scrubber, URL/status/enum validation, the 12-character password floor, and the i18n
dictionary (both languages for every key, plus every audit action having a label). It needs no Supabase
project, so it runs on any machine — including CI.


## 9. Known limits

Single owner — no team sharing, no per-room permissions. One vault key per deployment (no per-record keys yet).
No TOTP/WebAuthn second factor — the password plus the 5-minute unlock window is the gate. Thumbnails are
stored by URL, not uploaded, so there is no file-storage surface to secure.
