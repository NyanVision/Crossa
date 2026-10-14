# CatchYa — Expo / React Native / TypeScript

CatchYa is an existing Expo React Native app with TypeScript and React Navigation. The current screens, navigation, styles, and component layout remain in place; this backend integration replaces local-only service implementations with Supabase Auth, Postgres, Storage, and Realtime.

## Existing frontend structure

- `App.tsx` mounts the existing auth, appearance, and root navigation providers.
- `src/navigation/` contains auth navigation and the three-tab app with nested screen stacks.
- `src/screens/` contains auth, onboarding, discovery/QR, messages, profile, and settings screens.
- `src/components/` contains reusable forms, buttons, banners, and empty states.
- `src/context/` manages auth/session and appearance.
- `src/services/` contains the data/API boundary for Supabase, profiles, discovery, inbox, safety, QR, and settings.
- `supabase/migrations/` contains the database schema and RLS policies; `supabase/functions/delete-account/` contains the server-side permanent-delete operation.

## Backend features and privacy

- **Auth:** Supabase email/password and Google OAuth. Social profile links (Facebook, Telegram, X, TikTok, Instagram, LINE, WhatsApp, WeChat) are independent profile data, not login methods.
- **Direct Auth providers:** Supabase Auth directly documents Google and providers including Apple, Azure, Bitbucket, Discord, Facebook, Figma, GitHub, GitLab, Kakao, Keycloak, LinkedIn, Notion, Slack, Spotify, Twitter/X, Twitch, WorkOS, Zoom, and custom OAuth/OIDC. CatchYa currently exposes only Google plus email/password; another provider is not enabled by merely storing a social profile link.
- **Profiles:** display name, optional photo, age, bio, private gender and meet preferences, and individually controlled public social links. Photos use a private Storage bucket and short-lived signed URLs.
- **Nearby discovery:** off until the user turns it on; choices are 15 minutes, 30 minutes, or 1 hour. The selected end time is stored server-side, so expiry still applies after the app is closed. Foreground location is requested only for enabling/scanning. Exact coordinates are stored only in the non-API `private.discovery_locations` table while discovery is active, never returned to other users, and deleted on opt-out/expiry. The server applies mutual meet-preference filtering and returns only coarse distance bands. Automatic timer cleanup uses `pg_cron` when available; RPCs also check/expire sessions when used.
- **QR:** opaque, server-issued UUID tokens; QR profile lookup works independently of nearby location permission.
- **Messages:** requests must be accepted before a private chat can be read or written. RLS enforces the participant and accepted-status checks; inserts also use the authenticated sender ID. `public.messages` is enabled for Supabase Realtime.
- **Safety:** block and report operations persist to Supabase. Blocking makes requests and conversations unavailable to both participants.
- **Account controls:** deactivation hides the account and turns off discovery but retains data for reactivation. Permanent deletion uses an authenticated Edge Function, deletes private profile images, and deletes the Auth user so foreign-key cascades remove associated rows.
- **RLS:** enabled on every app-owned table, including the private location/grant tables. Client code uses only the project URL and publishable key. Never place a service-role key in the app or `.env`.

## 1. Create a Supabase project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard), sign in, choose **New project**, select an organization, and enter a project name, database password, and region.
2. Wait for project provisioning. Open the project’s **Connect** dialog or **Project Settings → API** and copy the **Project URL** and **Publishable key** (`sb_publishable_…`). These are the only Supabase values needed by the Expo client.
3. Keep the database password and any secret/service-role keys out of the client and out of chat. The permanent-delete function obtains its privileged key from the Edge Function runtime only.

## 2. Apply the database migration

Install/use the Supabase CLI (the project does not apply migrations automatically):

```bash
npm install
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

`YOUR_PROJECT_REF` is the project reference in the Dashboard URL. `db push` applies both timestamped migrations in order: the initial `20261014000000_catchya_backend.sql` schema and `20261014100000_add_30_minute_discovery_duration.sql` forward migration. The forward migration also upgrades a database that already has the initial CatchYa schema. No demo accounts or sample profiles are inserted; new profiles/preferences are provisioned by the Auth-user trigger.

To run the database locally instead of modifying the linked project:

```bash
npx supabase start
npx supabase db reset
npx supabase test db
```

Local Supabase requires Docker. The migration attempts to enable `pg_cron` for minute-level cleanup when available; session expiry is also enforced by the discovery RPCs.

## 3. Configure Auth

In Supabase Dashboard → **Authentication → URL Configuration**, add `catchya://auth/callback` to **Redirect URLs**. The app scheme is already `catchya` in `app.json`.

### Email and password

In **Authentication → Sign In / Providers → Email**, enable email/password. For practical testing, decide whether email confirmation should be required. If enabled, use a reachable test mailbox, click the confirmation link, then sign in. Configure the email templates/SMTP before production use; the default project email service has sending limits.

### Google OAuth (optional)

1. In [Google Cloud Console](https://console.cloud.google.com/), create/configure an OAuth consent screen and a **Web application** OAuth client.
2. In Supabase → **Authentication → Sign In / Providers → Google**, enable Google, enter the Google client ID and client secret, and copy the Supabase callback URL shown there (typically `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`).
3. Add that Supabase callback URL to the Google OAuth client’s **Authorized redirect URIs**.
4. Ensure `catchya://auth/callback` is present in Supabase’s redirect allow-list. CatchYa opens the Supabase OAuth flow and exchanges its PKCE authorization code.
5. For native testing, use a custom-scheme-capable development build (`npx expo run:ios` / `npx expo run:android` or an EAS development build). OAuth deep links are not a substitute for configuring the provider in Supabase.

No Facebook/Telegram/X/etc. social-profile link becomes a sign-in provider unless separately enabled and configured through Supabase Auth.

## 4. Configure local environment and run

Copy the placeholder file and fill it locally:

```bash
cp .env.example .env
```

Set these two values in `.env`:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PROJECT_KEY
```

Never put `SUPABASE_SERVICE_ROLE_KEY` or another secret in an `EXPO_PUBLIC_` variable. Restart Expo after changing environment variables:

```bash
npm install
npx expo start
```

Use a custom development build for native OAuth deep-link testing. The normal app screens render a clear “backend not configured” message if these variables are absent.

## 5. Enable server-side account deletion

Permanent deletion needs the included Edge Function because service-role operations must stay server-side. Supabase Edge Functions provide `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in the function runtime; do not copy the service-role key to the app.

For the linked project, deploy only this function when you are ready to enable account deletion:

```bash
npx supabase functions deploy delete-account
```

For local Supabase, run it with:

```bash
npx supabase functions serve delete-account --env-file supabase/.env.local
```

The local function environment file is for server-only values and must not be committed. The remote deployment command above is documentation only; this repository has not been deployed.

## 6. Tests and manual checks

Run app checks:

```bash
npm run typecheck
npm run lint
```

Run database integration tests against a running local Supabase instance:

```bash
npx supabase start
npx supabase db reset
npx supabase test db
```

`supabase/tests/database/catchya_permissions.test.sql` exercises profile row privacy, default-off discovery, coordinate-table denial, recipient-only request acceptance, rejection of pending-request messages, and accepted-chat message permissions.

Manual app checks after configuring a test project:

1. Create an account with email/password; if confirmation is on, confirm then sign in. Verify a blank profile leads to existing onboarding and saved profile data appears in Edit Profile/Settings.
2. Test Google sign-in only after enabling the Google provider and configuring both callback allow-lists.
3. In Discover, verify it starts off; grant foreground location; turn it on and select each duration (15 minutes, 30 minutes, and 1 hour); cancel and confirm that discovery stays off; then confirm a duration and scan. Deny location and confirm it does not enable. Turn discovery off and verify the service removes the stored location. Close/reopen after an expiry and confirm discovery remains off.
4. Create a second account on another device/simulator. Make both profiles discoverable and scan nearby. Confirm approximate distance only, no precise coordinates, and mutual meet preferences are honored.
5. Show one account’s QR code and scan it from the other. Confirm it navigates to the existing profile detail screen without enabling location.
6. Send a request. Confirm the recipient can accept/decline, the sender cannot accept on the recipient’s behalf, and messages are unavailable until acceptance. After acceptance, send messages from both clients and verify Realtime updates.
7. Test block/report and try to read/send in the blocked conversation. Test deactivation/sign-in reactivation and, on a disposable account, permanent deletion.

## Notes / production readiness

This work does not deploy anything. Before a public production release, configure real email delivery, verify OAuth/mobile builds, review the privacy/age and moderation policies for the intended jurisdictions, set retention/abuse controls, and confirm Realtime/Storage quotas. Supabase’s publishable key is safe in a client only because table access is constrained by RLS and sensitive operations stay in server-side functions.
