-- Watchme+ cross-device sync (anonymous-auth "sync space" model)
-- Paste the whole file into Supabase SQL editor and press Run. Safe to re-run.
--
-- Model: every device signs in anonymously (Auth -> Anonymous sign-ins must be ON).
-- A "space" is a private bucket of data. Devices join a space by a short-lived
-- pairing code. RLS lets a user touch only rows of spaces they are a member of.

------------------------------------------------------------------------------
-- 1. Core tables
------------------------------------------------------------------------------
create table if not exists public.spaces (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table if not exists public.space_members (
  space_id    uuid not null references public.spaces(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  device_name text check (device_name is null or char_length(device_name) <= 60),
  joined_at   timestamptz not null default now(),
  primary key (space_id, user_id)
);
create index if not exists space_members_user_idx on public.space_members (user_id);

create table if not exists public.pairing_codes (
  code_hash  text primary key,
  space_id   uuid not null references public.spaces(id) on delete cascade,
  created_by uuid,
  expires_at timestamptz not null,
  used_at    timestamptz
);
create index if not exists pairing_codes_creator_idx on public.pairing_codes (created_by);

create table if not exists public.pairing_attempts (
  user_id uuid not null,
  at      timestamptz not null default clock_timestamp()
);
create index if not exists pairing_attempts_user_idx on public.pairing_attempts (user_id, at);

------------------------------------------------------------------------------
-- 2. Synced data tables
--    Common columns: updated_at (server time, set by trigger), deleted
--    (tombstone), updated_by (set by trigger), client_ts (optional hint, see
--    sync_row_guard below).
------------------------------------------------------------------------------
create table if not exists public.watch_progress (
  space_id    uuid not null references public.spaces(id) on delete cascade,
  item_key    text not null check (char_length(item_key) <= 64),   -- 'movie:123' | 'ep:456'
  title_id    text not null check (char_length(title_id) <= 64),
  position_ms bigint not null default 0 check (position_ms >= 0),
  duration_ms bigint not null default 0 check (duration_ms >= 0),
  finished    boolean not null default false,
  meta        jsonb not null default '{}'::jsonb check (pg_column_size(meta) <= 8192),
  client_ts   timestamptz,
  deleted     boolean not null default false,
  updated_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  primary key (space_id, item_key)
);

create table if not exists public.my_list (
  space_id   uuid not null references public.spaces(id) on delete cascade,
  title_id   text not null check (char_length(title_id) <= 64),
  meta       jsonb not null default '{}'::jsonb check (pg_column_size(meta) <= 8192),
  client_ts  timestamptz,
  deleted    boolean not null default false,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (space_id, title_id)
);

create table if not exists public.ratings (
  space_id   uuid not null references public.spaces(id) on delete cascade,
  title_id   text not null check (char_length(title_id) <= 64),
  rating     smallint not null check (rating between 0 and 10),
  client_ts  timestamptz,
  deleted    boolean not null default false,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (space_id, title_id)
);

create table if not exists public.watched (
  space_id   uuid not null references public.spaces(id) on delete cascade,
  title_id   text not null check (char_length(title_id) <= 64),
  client_ts  timestamptz,
  deleted    boolean not null default false,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (space_id, title_id)
);

-- Synced (non-device) preferences only.
create table if not exists public.settings (
  space_id   uuid not null references public.spaces(id) on delete cascade,
  key        text not null check (char_length(key) <= 64),
  value      jsonb not null default 'null'::jsonb check (pg_column_size(value) <= 8192),
  client_ts  timestamptz,
  deleted    boolean not null default false,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (space_id, key)
);

create index if not exists watch_progress_upd_idx on public.watch_progress (space_id, updated_at);
create index if not exists my_list_upd_idx        on public.my_list        (space_id, updated_at);
create index if not exists ratings_upd_idx        on public.ratings        (space_id, updated_at);
create index if not exists watched_upd_idx        on public.watched        (space_id, updated_at);
create index if not exists settings_upd_idx       on public.settings       (space_id, updated_at);

------------------------------------------------------------------------------
-- 3. Row guard trigger: server time is authoritative.
--    * updated_at is ALWAYS now() (whatever the client sent).
--    * updated_by is ALWAYS auth.uid() when there is a caller.
--    * space_id cannot be changed by UPDATE.
--    * client_ts (optional, nullable) is an offline-replay hint: if the stored
--      row has a client_ts and the incoming one is OLDER, the update is
--      silently ignored (row stays as is, updated_at does not move). A client
--      timestamp more than 5 min in the future is clamped to now(), so a
--      wrong clock cannot lock a row. Clients that don't send client_ts get
--      plain last-write-wins by server time.
--    Client upsert: POST with  Prefer: resolution=merge-duplicates
--    (always send `deleted` explicitly: true = tombstone, false = revive).
------------------------------------------------------------------------------
create or replace function public.sync_row_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.client_ts is not null and new.client_ts > now() + interval '5 minutes' then
    new.client_ts := now();
  end if;

  if tg_op = 'UPDATE' then
    if new.space_id is distinct from old.space_id then
      raise exception 'space_id is immutable';
    end if;
    if new.client_ts is not null and old.client_ts is not null
       and new.client_ts < old.client_ts then
      return old;  -- stale offline replay: keep the newer stored row untouched
    end if;
  end if;

  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['watch_progress','my_list','ratings','watched','settings'] loop
    execute format('drop trigger if exists sync_row_guard on public.%I', t);
    execute format(
      'create trigger sync_row_guard before insert or update on public.%I
         for each row execute function public.sync_row_guard()', t);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 4. Row Level Security (enabled + forced everywhere)
------------------------------------------------------------------------------
-- Membership helper. SECURITY DEFINER so policies on space_members don't recurse.
create or replace function public.my_space_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select space_id from public.space_members where user_id = auth.uid();
$$;

do $$
declare t text;
begin
  foreach t in array array['spaces','space_members','pairing_codes','pairing_attempts',
                           'watch_progress','my_list','ratings','watched','settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    -- The owner (the role that runs this migration, normally `postgres`) needs an
    -- explicit policy because FORCE applies RLS to owners too. SECURITY DEFINER
    -- functions run as that role.
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format('create policy owner_all on public.%I for all to %I using (true) with check (true)',
                   t, current_user);
  end loop;
end $$;

-- Data tables: members only.
do $$
declare t text;
begin
  foreach t in array array['watch_progress','my_list','ratings','watched','settings'] loop
    execute format('drop policy if exists member_select on public.%I', t);
    execute format('drop policy if exists member_insert on public.%I', t);
    execute format('drop policy if exists member_update on public.%I', t);
    execute format('drop policy if exists member_delete on public.%I', t);
    execute format('create policy member_select on public.%I for select to authenticated
                      using (space_id in (select public.my_space_ids()))', t);
    execute format('create policy member_insert on public.%I for insert to authenticated
                      with check (space_id in (select public.my_space_ids()))', t);
    execute format('create policy member_update on public.%I for update to authenticated
                      using (space_id in (select public.my_space_ids()))
                      with check (space_id in (select public.my_space_ids()))', t);
    execute format('create policy member_delete on public.%I for delete to authenticated
                      using (space_id in (select public.my_space_ids()))', t);
  end loop;
end $$;

-- space_members: see members of your own spaces; delete only your own row.
drop policy if exists members_select on public.space_members;
create policy members_select on public.space_members for select to authenticated
  using (space_id in (select public.my_space_ids()));
drop policy if exists members_delete_self on public.space_members;
create policy members_delete_self on public.space_members for delete to authenticated
  using (user_id = auth.uid());
-- spaces, pairing_codes, pairing_attempts: no client policies at all (RPC only).

-- Table privileges: start from nothing, grant the minimum.
revoke all on public.spaces, public.space_members, public.pairing_codes, public.pairing_attempts,
              public.watch_progress, public.my_list, public.ratings, public.watched, public.settings
  from public, anon, authenticated;
grant select, insert, update, delete on
  public.watch_progress, public.my_list, public.ratings, public.watched, public.settings
  to authenticated;
grant select, delete on public.space_members to authenticated;

------------------------------------------------------------------------------
-- 5. RPC functions (SECURITY DEFINER, pinned search_path, authenticated only)
------------------------------------------------------------------------------
create or replace function public.ping()
returns timestamptz
language sql
stable
set search_path = public
as $$ select now(); $$;

-- Housekeeping. Not callable by clients. Called opportunistically from
-- create_pairing_code(); optionally schedule nightly with pg_cron (see README):
--   select cron.schedule('sync-cleanup', '17 3 * * *', 'select public.cleanup_sync()');
create or replace function public.cleanup_sync()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.pairing_codes
   where expires_at < now() - interval '1 hour' or used_at < now() - interval '1 hour';
  delete from public.pairing_attempts where at < now() - interval '1 day';
  delete from public.spaces s
   where not exists (select 1 from public.space_members m where m.space_id = s.id)
     and s.created_at < now() - interval '1 hour';
  -- Tombstones older than 90 days are no longer needed by any sane device.
  delete from public.watch_progress where deleted and updated_at < now() - interval '90 days';
  delete from public.my_list        where deleted and updated_at < now() - interval '90 days';
  delete from public.ratings        where deleted and updated_at < now() - interval '90 days';
  delete from public.watched        where deleted and updated_at < now() - interval '90 days';
  delete from public.settings       where deleted and updated_at < now() - interval '90 days';
end;
$$;

-- Internal: remove a user from their space(s); drop the space if it empties.
create or replace function public._leave_all(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare s uuid;
begin
  for s in select space_id from public.space_members where user_id = p_uid loop
    perform 1 from public.spaces where id = s for update;
    delete from public.space_members where space_id = s and user_id = p_uid;
    if not exists (select 1 from public.space_members where space_id = s) then
      delete from public.spaces where id = s;  -- cascades to codes and all data
    end if;
  end loop;
end;
$$;

create or replace function public.create_space(device_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select space_id into sid from public.space_members
   where user_id = uid order by joined_at limit 1;
  if sid is not null then return sid; end if;
  insert into public.spaces default values returning id into sid;
  insert into public.space_members (space_id, user_id, device_name)
    values (sid, uid, left(device_name, 60));
  return sid;
end;
$$;

create or replace function public.create_pairing_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- 31 chars, no 0 O 1 I L
  raw bytea;
  code text;
  i int;
  tries int := 0;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select space_id into sid from public.space_members
   where user_id = uid order by joined_at limit 1;
  if sid is null then raise exception 'not_a_member'; end if;

  perform public.cleanup_sync();
  delete from public.pairing_codes where created_by = uid and used_at is null;

  loop
    raw := uuid_send(gen_random_uuid());        -- 16 CSPRNG bytes (bytes 6 and 8 hold fixed bits)
    code := '';
    foreach i in array array[0,1,2,3,4,5,10,11] loop
      code := code || substr(alphabet, (get_byte(raw, i) % 31) + 1, 1);
    end loop;
    begin
      insert into public.pairing_codes (code_hash, space_id, created_by, expires_at)
      values (encode(sha256(convert_to(code, 'utf8')), 'hex'), sid, uid, now() + interval '10 minutes');
      return code;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 5 then raise; end if;
    end;
  end loop;
end;
$$;

-- Returns the space id on success. On a wrong/expired/used code it returns NULL
-- (NOT an exception: an exception would roll back the attempt record and defeat
-- the rate limit). After 5 failed attempts in 10 minutes it raises 'too_many_attempts'.
create or replace function public.redeem_pairing_code(code text, device_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  h text;
  sid uuid;
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  if (select count(*) from public.pairing_attempts
       where user_id = uid and at > clock_timestamp() - interval '10 minutes') >= 5 then
    raise exception 'too_many_attempts';
  end if;

  h := encode(sha256(convert_to(upper(regexp_replace(coalesce(code, ''), '[\s-]', '', 'g')), 'utf8')), 'hex');

  update public.pairing_codes
     set used_at = now()
   where code_hash = h and used_at is null and expires_at > now()
  returning space_id into sid;

  if sid is null then
    insert into public.pairing_attempts (user_id) values (uid);
    return null;
  end if;

  if not exists (select 1 from public.space_members where space_id = sid and user_id = uid) then
    perform public._leave_all(uid);  -- one space per user: move out of the old one
    insert into public.space_members (space_id, user_id, device_name)
      values (sid, uid, left(device_name, 60));
  end if;
  return sid;
end;
$$;

create or replace function public.leave_space()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  perform public._leave_all(auth.uid());
end;
$$;

create or replace function public.delete_space_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare sid uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select space_id into sid from public.space_members
   where user_id = auth.uid() order by joined_at limit 1;
  if sid is null then raise exception 'not_a_member'; end if;
  delete from public.watch_progress where space_id = sid;
  delete from public.my_list        where space_id = sid;
  delete from public.ratings        where space_id = sid;
  delete from public.watched        where space_id = sid;
  delete from public.settings       where space_id = sid;
end;
$$;

create or replace function public.list_devices()
returns table (device_name text, joined_at timestamptz, is_me boolean)
language sql
stable
security definer
set search_path = public
as $$
  select m.device_name, m.joined_at, (m.user_id = auth.uid())
    from public.space_members m
   where m.space_id in (select public.my_space_ids())
   order by m.joined_at;
$$;

-- Execute grants: nothing for PUBLIC/anon except ping().
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.ping() to anon, authenticated;
grant execute on function
  public.create_space(text), public.create_pairing_code(),
  public.redeem_pairing_code(text, text), public.leave_space(),
  public.delete_space_data(), public.list_devices(), public.my_space_ids()
  to authenticated;
-- Internal-only (no client grant): cleanup_sync(), _leave_all(uuid), sync_row_guard()
-- Trigger functions run regardless of EXECUTE grants.

------------------------------------------------------------------------------
-- 6. Realtime (guarded so re-runs and non-Supabase databases don't fail)
------------------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['watch_progress','my_list','ratings','watched','settings'] loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
