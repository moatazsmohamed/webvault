-- ============================================================================
--  WebVault — initial schema
--  Target: Supabase (PostgreSQL 15+)
--
--  HOW TO RUN
--    Supabase dashboard → SQL Editor → paste this whole file → Run.
--    Safe to re-run: every statement is IF NOT EXISTS / OR REPLACE.
--
--  ACCESS MODEL
--    The browser NEVER talks to Postgres. Every read and write goes through the
--    Next.js server, which uses the service_role key. Therefore RLS here is
--    deliberately deny-all for `anon` and `authenticated`: it exists so that a
--    leaked publishable/anon key can still read nothing.
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ----------------------------------------------------------------------------
--  enums
-- ----------------------------------------------------------------------------
do $$ begin
  create type public.url_kind as enum ('live','admin','developer','source','hosting');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.website_status as enum ('active','in_development','paused','archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.credential_kind as enum ('admin','developer','client','other');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
--  profiles — one row per app user (identity lives in auth.users)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  username      text not null unique,
  display_name  text not null default '',
  locale        text not null default 'ar' check (locale in ('ar','en')),
  theme         text not null default 'dark' check (theme in ('dark','light')),
  -- Verifier for the "re-authenticate before revealing a password" step.
  -- scrypt(password, salt) — a one-way hash, never the password itself.
  reveal_salt   text not null default '',
  reveal_hash   text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint profiles_username_shape check (username ~ '^[a-zA-Z0-9._-]{3,40}$')
);

-- ----------------------------------------------------------------------------
--  rooms — a category / client / company / project group
-- ----------------------------------------------------------------------------
create table if not exists public.rooms (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.profiles (id) on delete cascade,
  name         text not null,
  slug         text not null,
  description  text not null default '',
  color        text not null default '#6366f1' check (color ~ '^#[0-9a-fA-F]{6}$'),
  icon         text not null default 'folder',
  archived     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint rooms_name_shape    check (btrim(name) <> '' and char_length(name) <= 80),
  constraint rooms_desc_length   check (char_length(description) <= 500),
  constraint rooms_slug_shape    check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  constraint rooms_icon_shape    check (icon ~ '^[a-z0-9_-]{1,32}$'),
  unique (owner_id, slug)
);

create index if not exists rooms_owner_created_idx on public.rooms (owner_id, created_at desc);

-- ----------------------------------------------------------------------------
--  websites
-- ----------------------------------------------------------------------------
create table if not exists public.websites (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references public.profiles (id) on delete cascade,
  room_id           uuid not null references public.rooms (id) on delete cascade,
  name              text not null,
  description       text not null default '',
  category          text not null default '',
  client_name       text not null default '',
  thumbnail_url     text,
  status            public.website_status not null default 'active',
  notes             text not null default '',
  access_count      integer  not null default 0,
  last_accessed_at  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint websites_name_shape   check (btrim(name) <> '' and char_length(name) <= 120),
  constraint websites_desc_length  check (char_length(description) <= 600),
  constraint websites_notes_length check (char_length(notes) <= 2000),
  constraint websites_thumb_shape  check (thumbnail_url is null or thumbnail_url ~ '^https?://'),
  constraint websites_category_len check (char_length(category) <= 60),
  constraint websites_client_len   check (char_length(client_name) <= 120)
);

create index if not exists websites_room_idx        on public.websites (room_id);
create index if not exists websites_owner_created   on public.websites (owner_id, created_at desc);
create index if not exists websites_owner_status    on public.websites (owner_id, status);
create index if not exists websites_name_trgm       on public.websites using gin (name gin_trgm_ops);
create index if not exists websites_client_trgm     on public.websites using gin (client_name gin_trgm_ops);

-- ----------------------------------------------------------------------------
--  website_urls — the five link slots, each optional
-- ----------------------------------------------------------------------------
create table if not exists public.website_urls (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  website_id  uuid not null references public.websites (id) on delete cascade,
  kind        public.url_kind not null,
  url         text not null,
  label       text not null default '',
  created_at  timestamptz not null default now(),
  constraint urls_shape check (url ~ '^https?://[^[:space:]]+$'),
  constraint urls_label_len check (char_length(label) <= 60),
  unique (website_id, kind)
);

create index if not exists urls_website_idx on public.website_urls (website_id);

-- ----------------------------------------------------------------------------
--  credentials — the vault. Every secret column holds an envelope written by the
--  application server:  v<keyver>.<b64 iv>.<b64 gcm tag>.<b64 ciphertext>
--  Nothing here is ever readable without WEBVAULT_ENC_KEY, and no list/detail
--  endpoint returns *_enc columns.
-- ----------------------------------------------------------------------------
create table if not exists public.credentials (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references public.profiles (id) on delete cascade,
  website_id          uuid not null references public.websites (id) on delete cascade,
  account_type        public.credential_kind not null default 'admin',
  title               text not null default '',
  login_url           text,
  username_enc        text not null,
  password_enc        text not null,
  notes_enc           text,
  -- non-secret helpers so the UI is useful without decrypting anything
  username_hint       text not null default '',
  username_idx        text not null default '',
  key_version         smallint not null default 1,
  reveal_count        integer  not null default 0,
  last_revealed_at    timestamptz,
  password_changed_at timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint cred_title_len    check (char_length(title) <= 80),
  constraint cred_login_shape  check (login_url is null or login_url ~ '^https?://'),
  constraint cred_hint_len     check (char_length(username_hint) <= 20),
  constraint cred_idx_shape    check (username_idx = '' or username_idx ~ '^[0-9a-f]{64}$')
);

create index if not exists credentials_website_idx on public.credentials (website_id);
create index if not exists credentials_owner_idx   on public.credentials (owner_id, created_at desc);
create index if not exists credentials_username_idx on public.credentials (username_idx)
  where username_idx <> '';

-- ----------------------------------------------------------------------------
--  tags
-- ----------------------------------------------------------------------------
create table if not exists public.tags (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  constraint tags_name_shape check (btrim(name) <> '' and char_length(name) <= 32),
  unique (owner_id, name)
);

create table if not exists public.website_tags (
  website_id  uuid not null references public.websites (id) on delete cascade,
  tag_id      uuid not null references public.tags (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (website_id, tag_id)
);

create index if not exists website_tags_tag_idx on public.website_tags (tag_id);

-- ----------------------------------------------------------------------------
--  activity_logs — audit trail. detail is JSON but is hard-blocked from carrying
--  anything that looks like a secret, so a dump of this table is safe to share.
-- ----------------------------------------------------------------------------
create table if not exists public.activity_logs (
  id           bigint generated always as identity primary key,
  owner_id     uuid references public.profiles (id) on delete set null,
  action       text not null,
  entity_type  text not null default '',
  entity_id    text not null default '',
  detail       jsonb not null default '{}'::jsonb,
  ip           text not null default '',
  user_agent   text not null default '',
  created_at   timestamptz not null default now(),
  constraint log_action_shape check (action ~ '^[a-z][a-z_.]{1,40}$'),
  constraint log_no_secrets   check (detail::text !~* '"(password|pass|secret|token|apikey|api_key|authorization|credential[^s])"')
);

create index if not exists activity_created_idx on public.activity_logs (created_at desc);
create index if not exists activity_owner_idx   on public.activity_logs (owner_id, created_at desc);

-- ----------------------------------------------------------------------------
--  auth_attempts — login throttling that survives a server restart
-- ----------------------------------------------------------------------------
create table if not exists public.auth_attempts (
  key             text primary key,
  attempts        integer not null default 0,
  first_failed_at timestamptz not null default now(),
  last_failed_at  timestamptz not null default now(),
  locked_until    timestamptz
);

-- ----------------------------------------------------------------------------
--  triggers: keep updated_at honest
-- ----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','rooms','websites','credentials','tags'] loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$s;', t);
    execute format('create trigger trg_touch_%1$s before update on public.%1$s for each row execute function public.touch_updated_at();', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
--  RPC: login throttle (atomic)
--  Returns jsonb: { allowed, attempts, locked_until, retry_after_seconds }
-- ----------------------------------------------------------------------------
create or replace function public.auth_take_attempt(
  p_key text,
  p_max_attempts integer default 5,
  p_window_seconds integer default 900,
  p_lock_seconds integer default 900
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  row_ public.auth_attempts%rowtype;
  v_now timestamptz := now();
  v_allowed boolean := true;
  v_locked_until timestamptz;
  v_attempts integer := 0;
begin
  select * into row_ from public.auth_attempts where key = p_key for update;

  if found then
    -- window expired → reset the counter
    if row_.last_failed_at < v_now - make_interval(secs => p_window_seconds) then
      delete from public.auth_attempts where key = p_key;
      row_ := null;
    end if;
  end if;

  if found and row_.locked_until is not null and row_.locked_until > v_now then
    v_allowed := false;
    v_locked_until := row_.locked_until;
    v_attempts := row_.attempts;
  else
    insert into public.auth_attempts (key, attempts, first_failed_at, last_failed_at)
    values (p_key, 1, v_now, v_now)
    on conflict (key) do update
      set attempts = public.auth_attempts.attempts + 1,
          last_failed_at = v_now;

    select attempts into v_attempts from public.auth_attempts where key = p_key;

    if v_attempts >= p_max_attempts then
      v_locked_until := v_now + make_interval(secs => p_lock_seconds);
      update public.auth_attempts set locked_until = v_locked_until where key = p_key;
      v_allowed := false;
    end if;
  end if;

  return jsonb_build_object(
    'allowed', v_allowed,
    'attempts', v_attempts,
    'locked_until', v_locked_until,
    'retry_after_seconds',
      case when v_locked_until is not null
           then greatest(0, ceil(extract(epoch from (v_locked_until - v_now)))::int)
           else 0 end
  );
end $$;

create or replace function public.auth_clear_attempt(p_key text)
returns void language sql security definer set search_path = public as $$
  delete from public.auth_attempts where key = p_key;
$$;

create or replace function public.auth_attempt_state(p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    jsonb_build_object('attempts', attempts, 'locked_until', locked_until),
    '{"attempts":0,"locked_until":null}'::jsonb
  )
  from public.auth_attempts where key = p_key;
$$;

-- ----------------------------------------------------------------------------
--  RPC: one-time bootstrap guard — true while no account exists yet
-- ----------------------------------------------------------------------------
create or replace function public.webvault_is_first_run()
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles limit 1);
$$;

-- ----------------------------------------------------------------------------
--  RPC: room cards need counts; do it in one round trip
-- ----------------------------------------------------------------------------
create or replace function public.webvault_room_stats(p_owner uuid)
returns table (
  room_id uuid,
  website_count bigint,
  active_count bigint,
  dashboard_count bigint,
  incomplete_count bigint
)
language sql stable security definer set search_path = public as $$
  select
    r.id,
    count(w.id),
    count(w.id) filter (where w.status = 'active'),
    count(w.id) filter (where exists (
      select 1 from public.website_urls u where u.website_id = w.id and u.kind = 'admin'
    )),
    count(w.id) filter (
      where w.status <> 'archived' and (
        btrim(w.description) = ''
        or btrim(w.category) = ''
        or not exists (select 1 from public.website_urls u where u.website_id = w.id)
      )
    )
  from public.rooms r
  left join public.websites w on w.room_id = r.id
  where r.owner_id = p_owner
  group by r.id;
$$;

-- ----------------------------------------------------------------------------
--  Hardening: deny every public role. service_role bypasses RLS by role
--  attribute and is the only path in.
-- ----------------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.rooms           enable row level security;
alter table public.websites        enable row level security;
alter table public.website_urls    enable row level security;
alter table public.credentials     enable row level security;
alter table public.tags            enable row level security;
alter table public.website_tags    enable row level security;
alter table public.activity_logs   enable row level security;
alter table public.auth_attempts   enable row level security;

-- Explicit deny-all policies (no `to authenticated` grant means nothing matches,
-- but a policy is required for RLS to be considered "configured" by tooling).
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','rooms','websites','website_urls','credentials',
    'tags','website_tags','activity_logs','auth_attempts'
  ] loop
    execute format('drop policy if exists "deny_all" on public.%I;', t);
    execute format('create policy "deny_all" on public.%I for all to public using (false) with check (false);', t);
  end loop;
end $$;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- The first-run probe is the single exception: the login page needs to know
-- whether to point a visitor at /setup. It leaks only a boolean.
grant execute on function public.webvault_is_first_run() to anon, authenticated;

-- service_role needs the grants back even if a project template revokes defaults
grant usage on schema public to service_role;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;

alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;
