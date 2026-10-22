-- Watchme+ "sign in a TV with the phone" (device login). Run AFTER 0001_sync.sql and 0002_accounts.sql. Safe to re-run.
--
-- The TV (any authenticated session, anonymous too) calls request_device_login() and shows the code as a QR code.
-- A phone/PC that is signed in to an account calls approve_device_login(code). The TV's session then becomes a
-- member of the account's space; the TV polls check_device_login() to learn the space id.
-- Only the sha256 of a code is stored. Tables have RLS forced and no policies: reachable only through these functions.

create table if not exists public.device_logins (
  code_hash      text primary key,
  requester      uuid not null references auth.users(id) on delete cascade,
  device_name    text check (device_name is null or char_length(device_name) <= 60),
  expires_at     timestamptz not null,
  approved_space uuid references public.spaces(id) on delete cascade,
  approved_by    uuid,
  approved_at    timestamptz
);
create index if not exists device_logins_requester_idx on public.device_logins (requester);

-- One row per request, only to rate-limit request_device_login (device_logins rows are deleted when replaced).
create table if not exists public.device_login_requests (
  user_id uuid not null,
  at      timestamptz not null default clock_timestamp()
);
create index if not exists device_login_requests_user_idx on public.device_login_requests (user_id, at);

do $$
declare t text;
begin
  foreach t in array array['device_logins','device_login_requests'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format('create policy owner_all on public.%I for all to %I using (true) with check (true)',
                   t, current_user);
  end loop;
end $$;
revoke all on public.device_logins, public.device_login_requests from public, anon, authenticated;

-- cleanup_sync(): same as 0001 plus device logins (create or replace; keep in step with 0001).
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
  delete from public.device_logins where expires_at < now() - interval '1 hour';
  delete from public.device_login_requests where at < now() - interval '1 day';
  delete from public.spaces s
   where not exists (select 1 from public.space_members m where m.space_id = s.id)
     and s.created_at < now() - interval '1 hour';
  delete from public.watch_progress where deleted and updated_at < now() - interval '90 days';
  delete from public.my_list        where deleted and updated_at < now() - interval '90 days';
  delete from public.ratings        where deleted and updated_at < now() - interval '90 days';
  delete from public.watched        where deleted and updated_at < now() - interval '90 days';
  delete from public.settings       where deleted and updated_at < now() - interval '90 days';
end;
$$;

-- TV side: returns a fresh 10-minute code (plain, once). Replaces the caller's older pending requests.
-- Raises 'too_many_requests' after 10 requests in an hour.
create or replace function public.request_device_login(device_name text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- 31 chars, no 0 O 1 I L
  raw bytea;
  code text;
  i int;
  tries int := 0;
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  if (select count(*) from public.device_login_requests
       where user_id = uid and at > clock_timestamp() - interval '1 hour') >= 10 then
    raise exception 'too_many_requests';
  end if;
  insert into public.device_login_requests (user_id) values (uid);

  delete from public.device_logins where expires_at < now();
  delete from public.device_logins where requester = uid;

  loop
    raw := uuid_send(gen_random_uuid());
    code := '';
    foreach i in array array[0,1,2,3,4,5,10,11] loop
      code := code || substr(alphabet, (get_byte(raw, i) % 31) + 1, 1);
    end loop;
    begin
      insert into public.device_logins (code_hash, requester, device_name, expires_at)
      values (encode(sha256(convert_to(code, 'utf8')), 'hex'), uid, left(device_name, 60),
              now() + interval '10 minutes');
      return code;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 5 then raise; end if;
    end;
  end loop;
end;
$$;

-- Phone side. true on success; false on any failure (no detail; failures are counted, and as for
-- redeem_pairing_code 5 failures in 10 minutes raise 'too_many_attempts').
create or replace function public.approve_device_login(code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  h text;
  sid uuid;
  req record;
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  if (select count(*) from public.pairing_attempts
       where user_id = uid and at > clock_timestamp() - interval '10 minutes') >= 5 then
    raise exception 'too_many_attempts';
  end if;

  h := encode(sha256(convert_to(upper(regexp_replace(coalesce(code, ''), '[\s-]', '', 'g')), 'utf8')), 'hex');

  select space_id into sid from public.space_members
   where user_id = uid order by joined_at limit 1;

  if sid is not null then
    select * into req from public.device_logins
     where code_hash = h and approved_space is null and expires_at > now() and requester <> uid
     for update;
  end if;

  if sid is null or req.code_hash is null then
    insert into public.pairing_attempts (user_id) values (uid);
    return false;
  end if;

  if not exists (select 1 from public.space_members where space_id = sid and user_id = req.requester) then
    perform public._leave_all(req.requester);  -- one space per user: the TV leaves its guest space
    insert into public.space_members (space_id, user_id, device_name)
      values (sid, req.requester, req.device_name);
  end if;

  update public.device_logins
     set approved_space = sid, approved_by = uid, approved_at = now()
   where code_hash = h;
  return true;
end;
$$;

-- TV side (poll). The approved space id once (the row is deleted), null while pending, expired or absent.
create or replace function public.check_device_login()
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

  delete from public.device_logins where expires_at < now() and approved_space is null;

  delete from public.device_logins
   where requester = uid and approved_space is not null
  returning approved_space into sid;
  return sid;
end;
$$;

revoke execute on function public.request_device_login(text), public.approve_device_login(text),
  public.check_device_login() from public, anon, authenticated;
grant execute on function public.request_device_login(text), public.approve_device_login(text),
  public.check_device_login() to authenticated;
