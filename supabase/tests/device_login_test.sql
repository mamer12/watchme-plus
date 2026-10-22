-- Watchme+ device-login tests. Run AFTER 0001, 0002 and 0003, in the SQL editor or:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/device_login_test.sql
-- One transaction, rolled back: no data is left behind. A failed check raises; success prints "PASS ..." notices.
begin;

insert into auth.users (id) values
  ('aaaaaaaa-3000-0000-0000-00000000000a'),   -- A: account on phone (member)
  ('11111111-3000-0000-0000-000000000001'),   -- T: TV guest
  ('22222222-3000-0000-0000-000000000002'),   -- T2: second TV guest
  ('33333333-3000-0000-0000-000000000003'),   -- X: signed in but no space
  ('44444444-3000-0000-0000-000000000004'),   -- L: member who guesses wrongly
  ('55555555-3000-0000-0000-000000000005');   -- R: rate-limit victim

create temp table t_ctx (k text primary key, v text);
grant all on t_ctx to authenticated;

-- ===== A has a space with data; TV has its own guest space with data =============
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-3000-0000-0000-00000000000a","role":"authenticated"}';
do $$
declare sid uuid;
begin
  sid := public.create_space('A-phone');
  insert into t_ctx values ('aspace', sid::text);
  insert into public.my_list (space_id, title_id) values (sid, 'from-A');
end $$;

reset role; set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-3000-0000-0000-000000000004","role":"authenticated"}';
do $$ begin perform public.create_space('L'); end $$;

reset role; set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-3000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare sid uuid; code text; n int; h text; stored text;
begin
  sid := public.create_space('TV guest');
  insert into t_ctx values ('tvspace', sid::text);
  insert into public.my_list (space_id, title_id) values (sid, 'tv-only');

  assert public.check_device_login() is null, 'nothing requested yet -> null';

  code := public.request_device_login('Living room TV');
  assert code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$', 'code format: ' || code;
  insert into t_ctx values ('code', code);
  raise notice 'PASS code format and length';

  assert public.check_device_login() is null, 'pending -> null';
  raise notice 'PASS check pending returns null';

  -- a newer request invalidates the older one
  insert into t_ctx values ('oldcode', code);
  code := public.request_device_login('Living room TV');
  update t_ctx set v = code where k = 'code';
  raise notice 'PASS second request issued';
end $$;

-- hash-only storage, RLS closed to clients (checked as owner / as client)
reset role;
do $$
declare code text := (select v from t_ctx where k='code'); old text := (select v from t_ctx where k='oldcode'); n int;
begin
  select count(*) into n from public.device_logins where requester = '11111111-3000-0000-0000-000000000001';
  assert n = 1, 'older pending request replaced';
  select count(*) into n from public.device_logins
   where code_hash = encode(sha256(convert_to(code, 'utf8')), 'hex')
     and device_name = 'Living room TV' and expires_at between now() + interval '9 minutes' and now() + interval '10 minutes 1 second';
  assert n = 1, 'row stored by sha256 hash, ~10 minute expiry';
  select count(*) into n from public.device_logins where code_hash = code or code_hash = old;
  assert n = 0, 'plain code is not stored';
  assert (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.device_logins'::regclass), 'RLS forced';
  assert not exists (select 1 from pg_policies where tablename = 'device_logins' and roles <> array[current_user::name]), 'no client policies';
  raise notice 'PASS hash-only storage, RLS forced, no client policies';
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-3000-0000-0000-00000000000a","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin perform 1 from public.device_logins; exception when insufficient_privilege then ok := true; end;
  assert ok, 'clients cannot read device_logins';
  raise notice 'PASS clients cannot read the table';
end $$;

-- ===== failures return false ======================================================
-- requester cannot approve their own code
reset role; set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-3000-0000-0000-000000000001","role":"authenticated"}';
do $$ begin
  assert public.approve_device_login((select v from t_ctx where k='code')) = false, 'own code must fail';
  assert public.approve_device_login((select v from t_ctx where k='oldcode')) = false, 'replaced code must fail';
  raise notice 'PASS requester cannot approve own code; replaced code dead';
end $$;

-- non-member cannot approve
reset role; set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3000-0000-0000-000000000003","role":"authenticated"}';
do $$ begin
  assert public.approve_device_login((select v from t_ctx where k='code')) = false, 'non-member must fail';
  raise notice 'PASS non-member cannot approve';
end $$;

-- wrong code, then lockout after 5 wrong attempts (L is a member)
reset role; set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-3000-0000-0000-000000000004","role":"authenticated"}';
do $$
declare i int; blocked boolean := false;
begin
  for i in 1..5 loop
    assert public.approve_device_login('AAAAAAAA') = false, 'wrong code false';
  end loop;
  begin perform public.approve_device_login((select v from t_ctx where k='code'));
  exception when others then blocked := sqlerrm like '%too_many_attempts%'; end;
  assert blocked, 'lockout after 5 wrong attempts, even with the right code';
  raise notice 'PASS wrong codes false, 5 attempts -> too_many_attempts';
end $$;

-- expired code returns false
reset role;
update public.device_logins set expires_at = now() - interval '1 minute'
 where requester = '11111111-3000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-3000-0000-0000-00000000000a","role":"authenticated"}';
do $$ begin
  assert public.approve_device_login((select v from t_ctx where k='code')) = false, 'expired must fail';
  raise notice 'PASS expired code returns false';
end $$;

-- expired row is removed on check; TV asks again
reset role; set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-3000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare n int;
begin
  assert public.check_device_login() is null, 'expired -> null';
  reset role;
  select count(*) into n from public.device_logins where requester = '11111111-3000-0000-0000-000000000001';
  assert n = 0, 'expired row deleted by check';
  set local role authenticated;
  update t_ctx set v = public.request_device_login('Living room TV') where k = 'code';
  raise notice 'PASS expired -> null and row deleted';
end $$;

-- ===== approval ====================================================================
reset role; set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-3000-0000-0000-00000000000a","role":"authenticated"}';
do $$
declare c text := (select v from t_ctx where k='code');
begin
  -- lowercase and a dash are accepted, like pairing codes
  assert public.approve_device_login(lower(substr(c,1,4)) || '-' || substr(c,5)) = true, 'approve true';
  raise notice 'PASS approve returns true';
  assert public.approve_device_login(c) = false, 'used code must fail';
  raise notice 'PASS used code returns false';
end $$;

reset role;
do $$
declare n int; a uuid := (select v from t_ctx where k='aspace')::uuid; t uuid := (select v from t_ctx where k='tvspace')::uuid;
begin
  assert exists (select 1 from public.space_members where space_id = a and user_id = '11111111-3000-0000-0000-000000000001'
                   and device_name = 'Living room TV'), 'TV is a member of A space';
  select count(*) into n from public.space_members where user_id = '11111111-3000-0000-0000-000000000001'; assert n = 1, 'one space per user';
  select count(*) into n from public.spaces where id = t; assert n = 0, 'old guest space deleted';
  select count(*) into n from public.my_list where space_id = t; assert n = 0, 'old guest data deleted';
  assert exists (select 1 from public.device_logins where requester = '11111111-3000-0000-0000-000000000001'
                   and approved_space = a and approved_by = 'aaaaaaaa-3000-0000-0000-00000000000a' and approved_at is not null), 'request marked approved';
  raise notice 'PASS approval moved TV into A space, old guest space and data gone';
end $$;

-- A writes; the TV reads through RLS; then check returns the space once
reset role; set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-3000-0000-0000-00000000000a","role":"authenticated"}';
do $$ begin
  insert into public.my_list (space_id, title_id) values ((select v from t_ctx where k='aspace')::uuid, 'written-after');
end $$;

reset role; set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-3000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare n int; s uuid;
begin
  select count(*) into n from public.my_list where title_id in ('from-A','written-after'); assert n = 2, 'TV reads A data';
  insert into public.my_list (space_id, title_id) values ((select v from t_ctx where k='aspace')::uuid, 'from-TV');
  raise notice 'PASS shared access after approval';
  s := public.check_device_login();
  assert s = (select v from t_ctx where k='aspace')::uuid, 'check returns approved space';
  assert public.check_device_login() is null, 'second check -> null';
  raise notice 'PASS check approved -> space, then null';
end $$;

-- ===== rate limit on requests ======================================================
reset role; set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-3000-0000-0000-000000000005","role":"authenticated"}';
do $$
declare i int; blocked boolean := false;
begin
  for i in 1..10 loop perform public.request_device_login('r'); end loop;
  begin perform public.request_device_login('r'); exception when others then blocked := sqlerrm like '%too_many_requests%'; end;
  assert blocked, '11th request in an hour blocked';
  raise notice 'PASS 10 requests per hour';
end $$;

-- ===== anon cannot call any of the three ==========================================
reset role; set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare ok1 boolean := false; ok2 boolean := false; ok3 boolean := false;
begin
  begin perform public.request_device_login('x'); exception when insufficient_privilege then ok1 := true; end;
  begin perform public.approve_device_login('AAAAAAAA'); exception when insufficient_privilege then ok2 := true; end;
  begin perform public.check_device_login(); exception when insufficient_privilege then ok3 := true; end;
  assert ok1 and ok2 and ok3, 'anon must not call device-login functions';
  raise notice 'PASS anon cannot call any device-login function';
end $$;

rollback;
