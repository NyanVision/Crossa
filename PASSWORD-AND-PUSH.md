# Password recovery and push notifications

This change completes both flows on current main. It does not depend on the
older, unmerged backend-hardening PR.

## Password recovery

Reset email links return to `catchya://auth/reset-password`. The app handles
links while running and on cold launch, exchanges PKCE codes (including
`sb_flow_id`), and presents password/confirmation fields after verifying the
session. Duplicate callbacks share an exchange; network failures remain
retryable. Legacy recovery token fragments are supported. Successful updates
show a confirmation and let the user sign out.

In the **Crossa** project's Authentication → URL Configuration, allow both
`catchya://auth/callback` and `catchya://auth/reset-password`. The latter already
exists in the local Supabase configuration; the hosted allow-list must match.
Configure working email delivery. PKCE reset links must be opened on the
installation that requested them.

## Push deployment

Requires access to the actual Crossa Supabase project `hzqzpvaisxnyixqtzets`.
No hosted changes were made during implementation because the connected
account cannot access that project.

After reviewing the changes, sign in with the correct Supabase CLI account:

```bash
npx supabase@3.2.0 login
npm run push:deploy -- --project-ref hzqzpvaisxnyixqtzets
```

The script explicitly selects that project, applies pending migrations,
generates a random server-only worker secret, deploys both push functions,
stores the secret in Vault, and schedules delivery every minute through
pg_cron/pg_net. Private temporary files are removed afterward. Running it again
rotates the worker secret and replaces the named schedule. No paid
infrastructure or test messages are created.

If Expo push security is enabled, separately set `EXPO_ACCESS_TOKEN` through
Supabase secrets. It stays server-side. The client needs only its existing
public Supabase configuration.

Configure APNs/FCM push credentials for the existing EAS project, then build
and install a new development/production app. Expo Go and bundle export do not
replace a native build or physical-device tests. Existing native identifiers,
the Expo project, and the callback scheme are preserved.

## Delivery behavior

- Registration verifies the signed-in user and Auth session. A token and
  installation belong to one account at a time.
- Tokens refresh at login, on foregrounding and native token rotation.
  Automatic refresh never prompts for permission.
- Opt-out saves the server preference before unregistering. Logout removes
  registration; deletion of the Auth session also removes its devices.
- Database triggers queue requests, accepted requests and messages per device.
  App roles cannot access tokens or queue tables; RLS is enabled.
- Before sending, the worker checks both participants, both block directions,
  preferences, device ownership and session validity. Payloads contain generic
  text and conversation identifiers, without message previews or location.
- Atomic claims use expiring leases. Transient failures back off up to eight
  attempts. Expo receipts are checked after fifteen minutes. Invalidating an
  old token never disables its newly registered replacement.
- Sends expire after one hour, receipt checks stop after twenty-four hours,
  and queue history is removed after seven days.
- Delivery is at least once: a lost provider response can cause a duplicate
  after retry. An Expo receipt does not prove the user saw a notification.
- Taps wait for sign-in, reject another account's payload, and resolve the
  current conversation state through the authenticated inbox.

## Verification

```bash
npm ci --ignore-scripts
npm run typecheck
npm run lint
npm test
npx deno check --no-lock --node-modules-dir=manual supabase/functions/register-push-device/index.ts supabase/functions/dispatch-push/index.ts
npx expo export --platform ios --platform android --output-dir dist
```

The database tests run every real migration in embedded Postgres (PGlite) with
minimal Supabase-owned Auth/Storage fixtures. They test permissions, enqueue
triggers, blocks, opt-out, expiry, account switching, session deletion, lease
recovery, retries and token rotation. They do not run hosted Auth, PostgREST,
the scheduler, or APNs/FCM.

After deployment, use two disposable accounts on physical devices. Test reset
links with the app open and closed, expired links, password confirmation and
new-password sign-in. Test notification opt-in, requests, acceptance, messages,
taps, opt-out, both block directions, logout and account switching. Check Cron
run history and Edge Function logs for delivery failures; never log tokens or
credentials.
