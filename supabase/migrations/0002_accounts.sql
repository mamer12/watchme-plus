-- Watchme+ accounts (email + password). Run AFTER 0001_sync.sql. Safe to re-run.
--
-- Accounts need no new tables: a signed-in account is an auth user like any guest, and its sync space is the same
-- `space_members` row. The one thing the client cannot do for itself is delete its own auth user, so this adds
-- delete_my_account().

-- Removes the caller from every space (a space with no members left is deleted with all its data, see _leave_all in
-- 0001), then deletes the caller's auth user. Rows that reference auth.users (space_members) cascade.
-- SECURITY DEFINER because only the owner role may delete from auth.users; the caller can only ever delete themselves.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  perform public._leave_all(uid);
  delete from public.pairing_codes where created_by = uid;
  delete from public.pairing_attempts where user_id = uid;
  delete from auth.users where id = uid;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon, authenticated;
grant execute on function public.delete_my_account() to authenticated;
