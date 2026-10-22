# Watchme+ sync backend (Supabase)

Sync: every device signs in anonymously (a **guest**) or with an email and password (an **account**), has a private
"space", and syncs watch progress, My List, ratings, watched and synced settings. Guests link devices with an
8-character pairing code; an account just signs in with the same email and password on every device (see Accounts below).

## Owner setup

1. Create a project at supabase.com. Region: **Frankfurt (eu-central-1)**. Save the database password in a password
   manager only (never in the repo or Vercel).
2. **Authentication -> Sign In / Providers -> Anonymous sign-ins: ON.**
3. Authentication -> Rate Limits: the default for anonymous sign-ins is 30 per hour per IP. That is enough for a home
   (a new device = one sign-in); raise it only if you onboard many devices behind one IP.
4. **SQL Editor -> New query**, paste all of `supabase/migrations/0001_sync.sql`, Run. It is safe to re-run.
5. Optional: paste `supabase/tests/sync_test.sql` and Run. You should see `PASS ...` notices and no error; it rolls
   back, leaving no data.
6. **Project Settings -> API (or Data API / API Keys):** copy the *Project URL* and the *anon / publishable* key.
7. **Vercel -> Project -> Settings -> Environment Variables**, add (all environments):
   - `VITE_SUPABASE_URL` = Project URL
   - `VITE_SUPABASE_ANON_KEY` = anon key
   Public keys only. NEVER put the `service_role` key or the database password in Vercel, GitHub or the TV app. Redeploy.
8. Keep-alive (below).
9. Optional: if `pg_cron` is enabled (Database -> Extensions), schedule nightly cleanup:
   `select cron.schedule('sync-cleanup', '17 3 * * *', 'select public.cleanup_sync()');`
   Without it, cleanup runs whenever a pairing code is created.

### Keep-alive (free projects pause after 7 days without activity)
The workflow `.github/workflows/keepalive.yml` calls `rpc/ping` every 3 days. In GitHub -> Settings -> Secrets and
variables -> Actions -> **Variables** (not secrets) add `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Run it once from the
Actions tab (workflow_dispatch) to check it is green; a red run means the project is paused or down. Scheduled
workflows are also disabled by GitHub after 60 days without repo activity: re-enable if you get the email. Upgrading to
Pro removes the pause risk entirely. If paused: Dashboard -> Restore project.

### Backups (free plan has no dashboard backups; Database -> Backups is Pro-only)
- Full dump (Database -> Connect -> connection string; use the *Session pooler* string if IPv6 is unavailable):
  `pg_dump "postgresql://postgres.<ref>:<DB_PASSWORD>@<host>:5432/postgres" --schema=public --no-owner -Fc -f watchme-$(date +%F).dump`
  Restore: `pg_restore --no-owner -d "<new connection string>" watchme-....dump`
- Or per table: Table Editor -> table -> Export -> CSV.
Type the password in your terminal only.

## Accounts (email + password): OWNER'S DASHBOARD STEPS

Run `supabase/migrations/0002_accounts.sql` (SQL Editor, after 0001; safe to re-run), then optionally
`supabase/tests/accounts_test.sql` (PASS notices only, rolls back). It adds `delete_my_account()`.

Then, in the dashboard:

1. **Authentication -> Sign In / Providers -> Email:** enabled. **Confirm email: OFF.** Minimum password length: **8**.
2. **Anonymous sign-ins: stays ON** (guests, and the upgrade from guest to account).
3. **Authentication -> URL Configuration:** Site URL `https://watch-me-plus.vercel.app`; Redirect URLs: add
   `https://watch-me-plus.vercel.app/**` (and `http://localhost:5173/**` for local work).
4. Nothing to add in Vercel for sign-in itself. To show "Forgot password?" later set `VITE_AUTH_RECOVERY=1` (see below).

Trade-off of Confirm email OFF: the free plan has no email sending (SMTP), so addresses are not verified, a typo in the
email cannot be recovered, and **Forgot password does not work** until SMTP is added. The app hides "Forgot password?"
unless `VITE_AUTH_RECOVERY=1` is set at build time.

### Adding free SMTP later (Resend or Brevo) to turn on confirm-email and password recovery
1. Create a free Resend (or Brevo) account, verify a sending domain (or the free sender they give you), and make an SMTP
   password / API key. Keep it in the dashboard only.
2. **Project Settings -> Authentication -> SMTP Settings:** enable custom SMTP and fill host, port, user, password and a
   sender address.
3. **Authentication -> Sign In / Providers -> Email:** turn **Confirm email ON** if you want verified addresses.
   (Then sign-up answers "check your email" and the app says so.)
4. **Authentication -> Email Templates:** check the *Reset password* template links to `{{ .ConfirmationURL }}`.
5. Add `VITE_AUTH_RECOVERY=1` to Vercel (all environments) and redeploy: "Forgot password?" appears and the
   `#access_token=…&type=recovery` link opens a "Set a new password" screen.

Auth REST calls (for the TV app; all send `apikey: KEY`, and `Authorization: Bearer <access_token>` where noted):
- Upgrade a guest in place (keeps user id, space and data; bearer): `PUT {URL}/auth/v1/user` `{"email","password"}`
- Sign up with no session: `POST {URL}/auth/v1/signup` `{"email","password"}` then `create_space`
- Sign in: `POST {URL}/auth/v1/token?grant_type=password` `{"email","password"}` then `create_space` (idempotent: returns the
  user's existing space)
- Change password (bearer): `PUT {URL}/auth/v1/user` `{"password"}`
- Sign out this device only (bearer): `POST {URL}/auth/v1/logout?scope=local` (the default scope would sign out every device)
- Recovery (needs SMTP): `POST {URL}/auth/v1/recover` `{"email"}`
- Delete account (bearer): `POST {URL}/rest/v1/rpc/delete_my_account` `{}` (removes the user, its space and all its data)
- Signing in on a device that has a guest session with data of its own: ask "Add this device's data to your account?", then
  `leave_space` (or `delete_my_account` for the old guest user), sign in, `create_space`, and upload what was local.

## Data model

Tables (public, RLS enabled + forced): `spaces`, `space_members`, `pairing_codes`, `pairing_attempts` (RPC-only, no
client access), and synced: `watch_progress` (pk space_id,item_key), `my_list`, `ratings`, `watched` (pk space_id,title_id),
`settings` (pk space_id,key). Every synced row has `updated_at` (set by the server on every insert/update; whatever the
client sends is ignored), `deleted` (tombstone: set true instead of deleting), `updated_by`, and optional `client_ts`.

`client_ts` (optional): send the time the user really made the change when replaying offline-queued writes. If the stored
row has a newer `client_ts`, the stale write is ignored. Skip it for normal online writes (last write wins by server time).

RPCs (authenticated only, except `ping`): `ping()`, `create_space(device_name)`, `create_pairing_code()`,
`redeem_pairing_code(code, device_name)`, `leave_space()`, `delete_space_data()`, `list_devices()`, and (0002)
`delete_my_account()`.

Behaviours to know:
- One space per user. Redeeming a code leaves (and, if empty, deletes) the user's previous space.
- `redeem_pairing_code` returns **NULL** for any wrong/expired/used code (so the attempt can be counted) and raises
  `too_many_attempts` after 5 failures in 10 minutes. Codes last 10 minutes, are single use, case/space/dash-insensitive.
- Clients must store their anonymous session (refresh token) durably: losing it means losing access to the space until
  re-pairing from another device.
- Tombstones older than 90 days are purged by cleanup.
- Web (supabase-js): `supabase.from('watch_progress').upsert(rows, { onConflict: 'space_id,item_key' })` sends
  `Prefer: resolution=merge-duplicates`. Always include `deleted` explicitly (true = remove, false = revive).
- Realtime is enabled on the five data tables: subscribe with a filter `space_id=eq.<id>`.

## Sync REST cheat sheet for the TV app

`URL` = Project URL, `KEY` = anon key. All calls send `apikey: KEY`.

1. Anonymous sign-up (once; store `access_token`, `refresh_token`, `user.id` durably):
```
POST {URL}/auth/v1/signup
apikey: {KEY}
Content-Type: application/json

{}
```
-> `{"access_token":"eyJ...","expires_in":3600,"refresh_token":"abc...","user":{"id":"<uuid>"}}`

2. Refresh (every ~50 min or on 401; the refresh token is single-use, save the new one):
```
POST {URL}/auth/v1/token?grant_type=refresh_token
apikey: {KEY}
Content-Type: application/json

{"refresh_token":"abc..."}
```
-> same shape as sign-up.

All following calls also send `Authorization: Bearer <access_token>` and `Content-Type: application/json`.

3. Create space (idempotent), returns a JSON string uuid:
```
POST {URL}/rest/v1/rpc/create_space
{"device_name":"Living room TV"}
```
-> `"7b0c1f2e-...."`

4. Show a pairing code (from a device already in the space): `POST /rest/v1/rpc/create_pairing_code` body `{}`
-> `"K7M2QX4P"`. Join from another device: `POST /rest/v1/rpc/redeem_pairing_code`
`{"code":"K7M2QX4P","device_name":"Phone"}` -> `"<space uuid>"`, or `null` if the code is wrong/expired/used, or HTTP 400 with
`"message":"too_many_attempts"`.
Other RPCs (body `{}`): `list_devices`, `leave_space`, `delete_space_data`.

5. Upsert progress (batch allowed):
```
POST {URL}/rest/v1/watch_progress
Prefer: resolution=merge-duplicates,return=minimal

[{"space_id":"<id>","item_key":"ep:456","title_id":"99","position_ms":734000,"duration_ms":2700000,
  "finished":false,"deleted":false,"meta":{"title":"Show","poster":"/p.jpg","season":2,"episode":4}}]
```
-> 201/204 empty. Tombstone: same call with `"deleted":true`. Same pattern for `my_list`
(`{"space_id","title_id","meta","deleted"}`), `ratings` (+`"rating":8`), `watched`, `settings`
(`{"space_id","key":"lang","value":"ar","deleted":false}`).

6. Delta pull (store the largest `updated_at` you received; on first sync omit the filter). Use `gte` plus de-dup by key
if you want to be safe against equal timestamps; url-encode `+` as `%2B`:
```
GET {URL}/rest/v1/watch_progress?space_id=eq.<id>&updated_at=gt.2026-10-22T10:15:30.123456%2B00:00&order=updated_at.asc&limit=1000
```
-> `[{"space_id":"...","item_key":"ep:456","position_ms":734000,...,"deleted":false,"updated_at":"2026-10-22T10:16:02.5+00:00"}]`
Rows with `"deleted":true` are tombstones: remove them locally.

## Sign in a TV with the phone (0003_device_login.sql)

Run `0003_device_login.sql` after 0001 and 0002 (SQL editor, safe to re-run); test with `tests/device_login_test.sql`.
Nothing to switch on in the dashboard. Flow, all `POST {URL}/rest/v1/rpc/<name>`:
1. TV (guest session): `request_device_login` `{"device_name":"Living room TV"}` -> `"K7M2QX4P"` (valid 10 minutes; show
   it as a QR code). Max 10 requests per hour, else HTTP 400 `too_many_requests`.
2. Phone/PC (signed in, has a space): `approve_device_login` `{"code":"K7M2QX4P"}` -> `true`, or `false` for any
   problem (wrong, expired, used, your own TV), or HTTP 400 `too_many_attempts` (shares the 5-per-10-minutes counter
   of pairing codes).
3. TV polls `check_device_login` `{}` -> `null` while waiting; once approved, the account's space id (once). The TV
   has left its old guest space (and that space's data is deleted if it was the only member).
