-- Watchme+ account tests (delete_my_account). Run AFTER 0001 and 0002, in the SQL editor or:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/accounts_test.sql
-- One transaction, rolled back: no data is left behind. A failed check raises; success prints "PASS ..." notices.
begin;

insert into auth.users (id) values
  ('aaaaaaaa-1000-0000-0000-00000000000a'),
  ('bbbbbbbb-1000-0000-0000-00000000000b'),
  ('cccccccc-1000-0000-0000-00000000000c');

create temp table t_ctx (k text primary key, v text);
grant all on t_ctx to authenticated;

-- ===== A and B share a space; C has their own ==================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-1000-0000-0000-00000000000a","role":"authenticated"}';
do $$
declare sid uuid; code text;
begin
  sid := public.create_space('A-phone');
  insert into t_ctx values ('shared', sid::text);
  insert into public.my_list (space_id, title_id) values (sid, 'x1');
  code := public.create_pairing_code();
  insert into t_ctx values ('code', code);
end $$;

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-1000-0000-0000-00000000000b","role":"authenticated"}';
do $$
begin
  assert public.redeem_pairing_code((select v from t_ctx where k='code'), 'B-tv') is not null, 'B joins A';
end $$;

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-1000-0000-0000-00000000000c","role":"authenticated"}';
do $$
declare sid uuid;
begin
  sid := public.create_space('C-laptop');
  insert into t_ctx values ('solo', sid::text);
  insert into public.my_list (space_id, title_id) values (sid, 'c1');
  insert into public.settings (space_id, key, value) values (sid, 'profiles', '[]');
end $$;

-- ===== anon cannot call it =====================================================
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare ok boolean := false;
begin
  begin perform public.delete_my_account(); exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon must not call delete_my_account';
  raise notice 'PASS anon cannot delete accounts';
end $$;

-- ===== B deletes their account: the shared space survives, A keeps data =========
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-1000-0000-0000-00000000000b","role":"authenticated"}';
do $$ begin perform public.delete_my_account(); end $$;

reset role;
do $$
declare n int; sid uuid := (select v from t_ctx where k='shared')::uuid;
begin
  select count(*) into n from auth.users where id = 'bbbbbbbb-1000-0000-0000-00000000000b'; assert n = 0, 'B auth user gone';
  select count(*) into n from public.space_members where user_id = 'bbbbbbbb-1000-0000-0000-00000000000b'; assert n = 0, 'B membership gone';
  select count(*) into n from public.space_members where space_id = sid; assert n = 1, 'A still a member';
  select count(*) into n from public.my_list where space_id = sid; assert n = 1, 'shared data kept for A';
  select count(*) into n from auth.users where id = 'aaaaaaaa-1000-0000-0000-00000000000a'; assert n = 1, 'A untouched';
  raise notice 'PASS delete one member keeps the shared space';
end $$;

-- ===== C (sole member) deletes: space and all data go ===========================
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-1000-0000-0000-00000000000c","role":"authenticated"}';
do $$ begin perform public.delete_my_account(); end $$;

reset role;
do $$
declare n int; sid uuid := (select v from t_ctx where k='solo')::uuid;
begin
  select count(*) into n from auth.users where id = 'cccccccc-1000-0000-0000-00000000000c'; assert n = 0, 'C auth user gone';
  select count(*) into n from public.spaces where id = sid; assert n = 0, 'C space deleted';
  select count(*) into n from public.my_list where space_id = sid; assert n = 0, 'C list deleted';
  select count(*) into n from public.settings where space_id = sid; assert n = 0, 'C settings deleted';
  raise notice 'PASS delete sole member removes space and data';
end $$;

-- ===== a user with no space can delete too; the call needs a session ===========
insert into auth.users (id) values ('dddddddd-1000-0000-0000-00000000000d');
set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-1000-0000-0000-00000000000d","role":"authenticated"}';
do $$ begin perform public.delete_my_account(); end $$;
reset role;
do $$
declare n int;
begin
  select count(*) into n from auth.users where id = 'dddddddd-1000-0000-0000-00000000000d'; assert n = 0, 'D gone';
  raise notice 'PASS delete without a space';
end $$;

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated"}';
do $$
declare bad boolean := false;
begin
  begin perform public.delete_my_account(); exception when others then bad := sqlerrm like '%not_authenticated%'; end;
  assert bad, 'no uid must raise not_authenticated';
  raise notice 'PASS needs an authenticated user';
end $$;

rollback;
