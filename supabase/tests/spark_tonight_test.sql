-- Watchme+ Spark Tonight rate-limit tests. Run AFTER 0001 and 0004, in the SQL editor or:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/spark_tonight_test.sql
-- One transaction, rolled back: no data is left behind. A failed check raises; success prints "PASS ..." notices.
begin;

insert into auth.users (id) values
  ('aaaaaaaa-4000-0000-0000-00000000000a'),
  ('bbbbbbbb-4000-0000-0000-00000000000b');

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-4000-0000-0000-00000000000a","role":"authenticated"}';
do $$
declare i int;
begin
  for i in 1..30 loop
    assert public.spark_tonight_hit() = true, 'request ' || i || ' allowed';
  end loop;
  assert public.spark_tonight_hit() = false, '31st request in an hour refused';
  raise notice 'PASS 30 requests per hour, the 31st is refused';
end $$;

-- another user is not affected
reset role; set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-4000-0000-0000-00000000000b","role":"authenticated"}';
do $$ begin
  assert public.spark_tonight_hit() = true, 'limit is per user';
  raise notice 'PASS the limit is per user';
end $$;

-- the table is closed to clients
do $$
declare ok boolean := false;
begin
  begin perform 1 from public.spark_tonight_requests; exception when insufficient_privilege then ok := true; end;
  assert ok, 'clients cannot read spark_tonight_requests';
  raise notice 'PASS clients cannot read the table';
end $$;

-- old rows stop counting
reset role;
update public.spark_tonight_requests set at = clock_timestamp() - interval '2 hours'
 where user_id = 'aaaaaaaa-4000-0000-0000-00000000000a';
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-4000-0000-0000-00000000000a","role":"authenticated"}';
do $$ begin
  assert public.spark_tonight_hit() = true, 'allowed again after the hour';
  raise notice 'PASS requests older than an hour stop counting';
end $$;

-- anon cannot call it
reset role; set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare ok boolean := false;
begin
  begin perform public.spark_tonight_hit(); exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon must not call spark_tonight_hit';
  raise notice 'PASS anon cannot call spark_tonight_hit';
end $$;

rollback;
