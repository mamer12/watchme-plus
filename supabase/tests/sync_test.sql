-- Watchme+ sync tests. Run in the Supabase SQL editor (as postgres) AFTER the
-- migration, or: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/sync_test.sql
-- Everything runs in one transaction and is rolled back: no data is left behind.
-- Any failed check raises an exception (the script stops); success prints "PASS ..." notices.
begin;

-- Fixture users (auth.users only needs an id for these tests).
insert into auth.users (id) values
  ('aaaaaaaa-0000-0000-0000-00000000000a'),
  ('bbbbbbbb-0000-0000-0000-00000000000b'),
  ('cccccccc-0000-0000-0000-00000000000c'),
  ('dddddddd-0000-0000-0000-00000000000d');

create temp table t_ctx (k text primary key, v text);
grant all on t_ctx to authenticated;   -- scratch space shared across impersonated roles

-- ===== User A: create space, write data, make a pairing code ==================
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare sid uuid; sid2 uuid; code text; n int;
begin
  sid := public.create_space('A-phone');
  sid2 := public.create_space('ignored');
  assert sid = sid2, 'create_space must be idempotent';
  insert into t_ctx values ('space', sid::text);

  insert into public.watch_progress (space_id, item_key, title_id, position_ms, duration_ms, meta)
    values (sid, 'movie:1', '1', 1000, 5000, '{"title":"X"}');
  insert into public.my_list (space_id, title_id) values (sid, '1');
  select count(*) into n from public.watch_progress;
  assert n = 1, 'A sees own row';

  code := public.create_pairing_code();
  assert code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$', 'code format/alphabet: ' || code;
  insert into t_ctx values ('code', code);
  raise notice 'PASS A: space + data + code';
end $$;

-- ===== User B: isolation, wrong codes, then rate limiting =====================
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}';

do $$
declare n int; r uuid; i int; blocked boolean := false; sid uuid := (select v from t_ctx where k='space')::uuid;
begin
  select count(*) into n from public.watch_progress;  assert n = 0, 'B must not read A progress';
  select count(*) into n from public.my_list;         assert n = 0, 'B must not read A list';
  select count(*) into n from public.space_members;   assert n = 0, 'B must not read A members';
  begin
    insert into public.my_list (space_id, title_id) values (sid, 'evil');
    raise exception 'B insert into A space was allowed';
  exception when insufficient_privilege or others then
    if sqlerrm like 'B insert%' then raise; end if;
  end;
  begin perform public.create_pairing_code(); raise exception 'non-member got a code';
  exception when others then if sqlerrm like 'non-member%' then raise; end if; end;
  begin perform 1 from public.pairing_codes; raise exception 'B could read pairing_codes';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS B isolation';

  -- wrong codes fail generically (NULL), 5 of them
  for i in 1..5 loop
    r := public.redeem_pairing_code('WRONG' || i, 'B-tv');
    assert r is null, 'wrong code must return null';
  end loop;
  -- 6th attempt is blocked, even with the correct code
  begin
    r := public.redeem_pairing_code((select v from t_ctx where k='code'), 'B-tv');
  exception when others then
    blocked := sqlerrm like '%too_many_attempts%';
  end;
  assert blocked, 'rate limit must trigger after 5 wrong attempts';
  raise notice 'PASS B wrong codes + rate limit';
end $$;

-- ===== User C: redeem the real code, then reuse fails ==========================
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-00000000000c","role":"authenticated"}';

do $$
declare r uuid; n int; sid uuid := (select v from t_ctx where k='space')::uuid;
begin
  r := public.redeem_pairing_code(lower((select v from t_ctx where k='code')), 'C-tablet');
  assert r = sid, 'redeem returns the space id (case-insensitive)';
  select count(*) into n from public.watch_progress; assert n = 1, 'C now sees A data';
  select count(*) into n from public.list_devices(); assert n = 2, 'two devices listed';
  -- C writes, which A must later see
  insert into public.watch_progress (space_id, item_key, title_id, position_ms)
    values (sid, 'ep:9', '9', 42);
  raise notice 'PASS C redeem + shared access';
end $$;

-- ===== User D: used and expired codes fail generically =========================
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-00000000000d","role":"authenticated"}';
do $$
declare r uuid;
begin
  r := public.redeem_pairing_code((select v from t_ctx where k='code'), 'D');
  assert r is null, 'used code must fail';
end $$;

-- expire a fresh code (as A), then try as D
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}';
do $$ begin
  update t_ctx set v = public.create_pairing_code() where k = 'code';
end $$;
reset role;
update public.pairing_codes set expires_at = now() - interval '1 minute';
set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-00000000000d","role":"authenticated"}';
do $$
declare r uuid;
begin
  r := public.redeem_pairing_code((select v from t_ctx where k='code'), 'D');
  assert r is null, 'expired code must fail';
  raise notice 'PASS D used + expired codes fail generically';
end $$;

-- ===== Tombstones, server-authoritative updated_at, stale replay ===============
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}';
do $$
declare sid uuid := (select v from t_ctx where k='space')::uuid; u1 timestamptz; u2 timestamptz; d boolean; pos bigint; bad boolean := false;
begin
  -- client sends an ancient updated_at: must be overwritten by server time
  insert into public.watch_progress (space_id, item_key, title_id, position_ms, updated_at)
    values (sid, 'movie:2', '2', 10, '2001-01-01') on conflict (space_id, item_key) do nothing;
  select updated_at into u1 from public.watch_progress where item_key = 'movie:2';
  assert u1 > now() - interval '1 minute', 'updated_at must be server time on insert';

  -- upsert (what PostgREST merge-duplicates does) with an old updated_at
  insert into public.watch_progress (space_id, item_key, title_id, position_ms, updated_at)
    values (sid, 'movie:2', '2', 99, '2001-01-01')
    on conflict (space_id, item_key) do update
      set position_ms = excluded.position_ms, updated_at = excluded.updated_at;
  select updated_at, position_ms into u2, pos from public.watch_progress where item_key = 'movie:2';
  assert u2 > now() - interval '1 minute' and pos = 99, 'updated_at is server time on upsert';

  -- tombstone via upsert
  insert into public.my_list (space_id, title_id, deleted) values (sid, '1', true)
    on conflict (space_id, title_id) do update set deleted = excluded.deleted;
  select deleted into d from public.my_list where title_id = '1';
  assert d, 'tombstone stored';
  -- revive
  insert into public.my_list (space_id, title_id, deleted) values (sid, '1', false)
    on conflict (space_id, title_id) do update set deleted = excluded.deleted;
  select deleted into d from public.my_list where title_id = '1';
  assert not d, 'tombstone revived';

  -- stale offline replay with client_ts is ignored
  insert into public.watch_progress (space_id, item_key, title_id, position_ms, client_ts)
    values (sid, 'movie:3', '3', 500, '2024-06-02');
  insert into public.watch_progress (space_id, item_key, title_id, position_ms, client_ts)
    values (sid, 'movie:3', '3', 100, '2024-06-01')
    on conflict (space_id, item_key) do update
      set position_ms = excluded.position_ms, client_ts = excluded.client_ts;
  select position_ms into pos from public.watch_progress where item_key = 'movie:3';
  assert pos = 500, 'older client_ts must not overwrite newer';

  -- space_id is immutable
  begin
    update public.watch_progress set space_id = gen_random_uuid() where item_key = 'movie:3';
  exception when others then bad := true; end;
  assert bad, 'space_id change must fail';
  raise notice 'PASS tombstones + server time + stale replay';
end $$;

-- ===== anon has no access =======================================================
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare ok boolean := false;
begin
  begin perform 1 from public.watch_progress; exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon must not read data tables';
  ok := false;
  begin perform public.create_space('x'); exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon must not call create_space';
  assert public.ping() is not null, 'anon can ping';
  raise notice 'PASS anon locked out, ping ok';
end $$;

-- ===== delete_space_data, leave_space ==========================================
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-00000000000c","role":"authenticated"}';
do $$
declare n int; sid uuid := (select v from t_ctx where k='space')::uuid;
begin
  perform public.delete_space_data();
  select count(*) into n from public.watch_progress; assert n = 0, 'data wiped';
  select count(*) into n from public.list_devices(); assert n = 2, 'space + members kept';
  perform public.leave_space();
  select count(*) into n from public.list_devices(); assert n = 0, 'C left';
  raise notice 'PASS delete_space_data + leave (one left)';
end $$;

set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}';
do $$
declare n int; sid uuid := (select v from t_ctx where k='space')::uuid;
begin
  insert into public.my_list (space_id, title_id) values (sid, 'last');
  perform public.leave_space();
  select count(*) into n from public.my_list; assert n = 0;
  reset role;
  select count(*) into n from public.spaces where id = sid;
  assert n = 0, 'space deleted when last member leaves';
  select count(*) into n from public.my_list where space_id = sid;
  assert n = 0, 'space data deleted when last member leaves';
  raise notice 'PASS leave_space cleans up';
end $$;

rollback;
