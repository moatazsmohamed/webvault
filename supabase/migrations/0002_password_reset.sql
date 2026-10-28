-- ============================================================================
--  WebVault — password recovery by email code
--  Target: Supabase (PostgreSQL 15+)
--
--  HOW TO RUN
--    Supabase dashboard → SQL Editor → paste this whole file → Run.
--    Safe to re-run: every statement is IF NOT EXISTS / OR REPLACE.
--
--  WHAT THIS ADDS
--    profiles.recovery_email   where a reset code may be sent (set from Settings,
--                              while signed in — a locked-out user cannot change it)
--    profiles.sessions_revoked_at  every GoTrue session issued before this instant
--                              is treated as signed out (a reset must evict the
--                              sessions the old password was used for)
--    password_resets           one-time codes. Only the HMAC of the code is stored,
--                              so a database dump cannot reset anybody's password.
-- ============================================================================

alter table public.profiles add column if not exists recovery_email text not null default '';
alter table public.profiles add column if not exists sessions_revoked_at timestamptz;

do $$ begin
  alter table public.profiles
    add constraint profiles_recovery_email_shape
    check (recovery_email = '' or recovery_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$');
exception when duplicate_object then null; end $$;

create table if not exists public.password_resets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  -- HMAC-SHA256(WEBVAULT_SESSION_SECRET, user_id || '.' || code), hex.
  code_hash    text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at   timestamptz not null,
  attempts     integer not null default 0,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now(),
  -- The code is only ever sent to a verified-format address, and nothing here
  -- stores the address itself: it is read from profiles at send time.
  constraint password_resets_ttl check (expires_at > created_at)
);

create index if not exists password_resets_user_idx on public.password_resets (user_id, created_at desc);

-- ----------------------------------------------------------------------------
--  RPC: the two writes a reset needs, done atomically in one round trip.
-- ----------------------------------------------------------------------------

-- Issue a code: expire whatever is outstanding, then insert the new row.
create or replace function public.webvault_begin_reset(p_user uuid, p_code_hash text, p_ttl_seconds integer)
returns uuid
language sql security definer set search_path = public as $$
  with stale as (
    update public.password_resets
       set consumed_at = now()
     where user_id = p_user and consumed_at is null
     returning 1
  )
  insert into public.password_resets (user_id, code_hash, expires_at)
  values (p_user, p_code_hash, now() + make_interval(secs => p_ttl_seconds))
  returning id;
$$;

-- Spend the code: only an unconsumed, unexpired row for this user can match, and
-- the attempt counter is bumped in the same statement so a race cannot get extra tries.
create or replace function public.webvault_consume_reset(p_user uuid, p_code_hash text, p_max_attempts integer)
returns table (consumed_id uuid, matched boolean, attempts integer)
language plpgsql security definer set search_path = public as $$
declare
  row_ public.password_resets%rowtype;
begin
  select * into row_
    from public.password_resets
   where user_id = p_user
     and consumed_at is null
     and expires_at > now()
   order by created_at desc
   limit 1
     for update;

  if not found then
    return query select null::uuid, false, 0;
    return;
  end if;

  if row_.attempts >= p_max_attempts then
    update public.password_resets set consumed_at = now() where id = row_.id;
    return query select row_.id, false, row_.attempts;
    return;
  end if;

  if row_.code_hash = p_code_hash then
    update public.password_resets
       set consumed_at = now(), attempts = row_.attempts + 1
     where id = row_.id
       and user_id = p_user;
    -- one good try is enough: nothing else may be outstanding for this account
    update public.password_resets set consumed_at = now()
     where user_id = p_user and id <> row_.id and consumed_at is null;
    return query select row_.id, true, row_.attempts + 1;
  else
    update public.password_resets set attempts = row_.attempts + 1 where id = row_.id;
    return query select row_.id, false, row_.attempts + 1;
  end if;
end $$;

-- A successful reset must invalidate the token it just issued nothing older than,
-- so the timestamp lands in the same statement as the code cleanup.
create or replace function public.webvault_complete_reset(p_user uuid)
returns void
language sql security definer set search_path = public as $$
  update public.profiles
     set sessions_revoked_at = now() - interval '1 second'
   where id = p_user;
  delete from public.password_resets where user_id = p_user;
$$;

-- ----------------------------------------------------------------------------
--  Hardening — same deny-all model as the rest of the schema.
-- ----------------------------------------------------------------------------
alter table public.password_resets enable row level security;

do $$ begin
  drop policy if exists "deny_all" on public.password_resets;
  create policy "deny_all" on public.password_resets for all to public using (false) with check (false);
end $$;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

grant usage on schema public to service_role;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;

alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;
