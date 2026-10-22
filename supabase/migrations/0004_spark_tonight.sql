-- Watchme+ "Spark Tonight" (AI chat) rate limit. Run AFTER 0001. Safe to re-run.
--
-- The spark-tonight Edge Function calls spark_tonight_hit() with the caller's own JWT (anonymous users count).
-- It records one row per request and returns false once the caller made 30 requests in the last hour.
-- Only the user id and a timestamp are stored: no chat text, no taste data. The table has RLS forced and no
-- policies: reachable only through the function.

create table if not exists public.spark_tonight_requests (
  user_id uuid not null,
  at      timestamptz not null default clock_timestamp()
);
create index if not exists spark_tonight_requests_user_idx on public.spark_tonight_requests (user_id, at);

alter table public.spark_tonight_requests enable row level security;
alter table public.spark_tonight_requests force row level security;
drop policy if exists owner_all on public.spark_tonight_requests;
create policy owner_all on public.spark_tonight_requests for all to postgres using (true) with check (true);
revoke all on public.spark_tonight_requests from public, anon, authenticated;

-- true: allowed (and counted). false: over the limit (not counted). Raises 'not_authenticated' without a user.
create or replace function public.spark_tonight_hit()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  -- old rows of this user go first, so the table stays small without a cron job
  delete from public.spark_tonight_requests where user_id = uid and at < clock_timestamp() - interval '1 day';

  if (select count(*) from public.spark_tonight_requests
       where user_id = uid and at > clock_timestamp() - interval '1 hour') >= 30 then
    return false;
  end if;
  insert into public.spark_tonight_requests (user_id) values (uid);
  return true;
end;
$$;

revoke all on function public.spark_tonight_hit() from public, anon;
grant execute on function public.spark_tonight_hit() to authenticated;
