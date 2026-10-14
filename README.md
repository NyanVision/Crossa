# CatchYa — Expo / React Native / TypeScript

CatchYa is a single Expo React Native codebase for iOS and Android. This branch adds a Supabase backend and beta-hardening work while retaining the existing navigation, screens, and visual style.

## Existing app structure

- `App.tsx`: existing provider and root-navigation composition.
- `src/navigation/`: auth navigation and the Discover, Messages, and Profile tabs with nested stacks.
- `src/screens/`: existing auth, onboarding, discover/QR, inbox/chat, profile, and settings screens.
- `src/components/`: reusable forms, controls, and signed-profile-photo component.
- `src/context/`: Supabase session/auth state and light/dark/system appearance.
- `src/services/`: Supabase client and domain operations for profiles, discovery, inbox, safety, QR, notifications, moderation, and settings.
- `supabase/migrations/`: schema, RLS, RPCs, cleanup, hardening, moderation, and account lifecycle changes.
- `supabase/functions/`: server-only account deletion, push-token registration, and push dispatch.
- `.github/workflows/ci.yml`: app checks, native bundle exports, and local Supabase/pgTAP checks.

## Backend behavior and privacy

- **Authentication:** email/password and Google OAuth are implemented. Google is a Supabase Auth provider; it must be enabled/configured in the Supabase project. Social profile links (Facebook, Telegram, X, TikTok, Instagram, LINE, WhatsApp, WeChat) are separate user profile data and do not enable sign-in.
- **Provider support:** Supabase Auth has built-in OAuth providers, including Google, Apple, Azure, Bitbucket, Discord, Facebook, GitHub, GitLab, Kakao, Keycloak, LinkedIn, Notion, Slack, Spotify, Twitter/X, Twitch, WorkOS, and Zoom, plus custom OAuth/OIDC options. CatchYa only wires email/password and Google. Check [Supabase Auth providers](https://supabase.com/docs/guides/auth) for the current list and configuration; do not infer that any social-link platform is a configured login provider.
- **Profiles:** display name, optional photo, self-declared age, bio, private gender and meet preferences, and individually controlled public social links. Photos use a private Storage bucket and expiring signed URLs.
- **Age:** current onboarding accepts an optional age from 13 to 120. No minimum-age policy change was made; the intended minimum remains a product decision. Age is self-declared, not verified. Decide and enforce the intended policy before private beta.
- **Nearby discovery:** off by default. Enabling prompts for 15-minute, 30-minute, or 1-hour visibility. Expiry is stored and checked server-side, including after app closure. Foreground location is requested only for explicit discovery actions. Exact coordinates are held in the non-API `private.discovery_locations` table only while discovery is active, never returned to another user, and removed on opt-out/expiry. The server filters for mutual meet preferences and returns approximate distance bands only. A `pg_cron` cleanup job removes expired private location rows; RPCs also fail closed and expire rows when used.
- **QR:** opaque server-issued profile tokens; scanning does not enable nearby discovery or require location permission.
- **Requests and chat:** only the intended recipient can accept a request. Message reads/writes require an accepted request and authorized active participants. `public.messages` is in the Supabase Realtime publication. Inbox and message history use cursor pagination and message sends have client-generated idempotency IDs.
- **Archive and safety:** each participant can hide a conversation only from their own inbox without deleting shared messages. Blocks suppress further interaction; reports are stored for review.
- **Moderation:** the report queue and decisions are moderator-only server RPCs. Account suspensions prevent normal self-reactivation; moderation decisions are audited. Requests, messages, and reports have server-side rate limits. The first administrator must be provisioned by a trusted project owner (instructions below).
- **Push notifications:** authenticated Edge Function registration supports multiple devices per account. The protected dispatcher checks current account and preference state, blocks, and request/chat status; uses minimal payloads; records per-device deliveries; retries and suppresses duplicates; and disables invalid device tokens. Logout turns off the account preference and removes the current device registration before ending the session. Delivery is not active until functions, device credentials, and a scheduler are configured.
- **Account lifecycle:** deactivation hides the account and disables discovery/notifications while retaining data for reactivation. Permanent deletion uses an authenticated Edge Function and removes profile photos before deleting the Auth user so related database rows cascade.
- **RLS and secrets:** RLS is enabled on app tables, including private location, role, rate-limit, and push-delivery tables. The Expo app receives only the project URL and publishable key. The service-role key is used only inside Supabase Edge Functions and must never be committed or placed in an `EXPO_PUBLIC_` variable.

## 1. Create a development Supabase project

1. In the [Supabase Dashboard](https://supabase.com/dashboard), choose **New project**. Create a dedicated development/staging project in the organization and region you want to use. Do not point these migrations at production during initial setup.
2. Wait for provisioning. In **Project Settings → API** (or the project **Connect** dialog), copy the **Project URL** and the **Publishable key** (`sb_publishable_…`). These two values are used by the Expo client.
3. Keep the database password and secret/service-role keys in the project’s secure settings. Do not paste them into source files, `EXPO_PUBLIC_` variables, GitHub, or chat.

No Supabase project was linked, migrated, or deployed during this implementation.

## 2. Apply migrations

From the repository root, install the Supabase CLI if needed, authenticate, and link only the new development project:

```bash
npm ci
npx supabase login
npx supabase link --project-ref YOUR_DEV_PROJECT_REF
npx supabase db push
```

The ordered migrations are:

1. `20261014000000_catchya_backend.sql` — core profiles, discovery, requests, messages, privacy-safe RPCs, Storage policies, and initial RLS.
2. `20261014100000_add_30_minute_discovery_duration.sql` — forward migration for exactly 15/30/60-minute sessions.
3. `20261014200000_catchya_beta_hardening.sql` — account status, per-user inbox state, push/outbox tables, private moderator/rate-limit tables, and stricter authorization.
4. `20261014210000_account_state_lifecycle_fix.sql` — safe account-state transitions.
5. `20261014220000_moderator_role_accessor.sql` — caller-only moderator-role accessor for the conditional Settings entry.
6. `20261014230000_inbox_requests_realtime.sql` — RLS-filtered request-status events for live inbox updates.
7. `20261014240000_private_account_status_helper.sql` — prevent direct account-status UUID probing while retaining participant-scoped message access.

The repository’s seed file deliberately creates no fake accounts or profiles. Supabase Auth creates real users and the profile trigger provisions their CatchYa rows.

For local database tests, use the Docker-backed local Supabase stack (these commands affect only that local stack):

```bash
npx supabase start
npx supabase db reset
npm run test:db
```

Never run `db reset` against a linked hosted project. `db push` applies forward migrations; review its planned changes before confirming.

## 3. Configure Auth providers and email

In Supabase **Authentication → URL Configuration**, allow these redirects:

- `catchya://auth/callback`
- `catchya://auth/reset-password`

The app scheme is `catchya` in `app.json`.

### Email/password and recovery

In **Authentication → Sign In / Providers → Email**, enable email/password. For testing, decide whether email confirmation is required and use a reachable mailbox. Configure confirmation and password-recovery email templates/redirects to use the allowed CatchYa scheme. Supabase’s default email service has sending limits; configure a real SMTP provider before beta distribution. Recovery links open the new-password screen and return a completion state after the password change.

### Google (optional)

1. In [Google Cloud Console](https://console.cloud.google.com/), configure the OAuth consent screen and create a **Web application** OAuth client.
2. In Supabase **Authentication → Sign In / Providers → Google**, enable Google and enter the client ID and client secret.
3. Copy the callback URL shown by Supabase (normally `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`) into the Google OAuth client’s **Authorized redirect URIs**.
4. Confirm `catchya://auth/callback` is in Supabase’s redirect allow-list.
5. Test native OAuth in an iOS/Android development build with the CatchYa URL scheme. Google credentials stay in Supabase provider settings; there are no Google client-ID placeholders in the app config.

## 4. Configure the app and run it locally

Copy the placeholder-only environment file and edit `.env` locally:

```bash
cp .env.example .env
```

Set only:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_DEV_PROJECT_REF.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_DEV_KEY
```

Then restart Expo:

```bash
npm ci
npx expo start
```

For native auth deep-link testing, build/run the existing app using the installed Xcode/Android toolchain:

```bash
npx expo run:ios
npx expo run:android
```

Never add `SUPABASE_SERVICE_ROLE_KEY`, an OAuth client secret, `PUSH_WORKER_SECRET`, or another secret to `.env` or an `EXPO_PUBLIC_` variable. The app displays a backend-configuration message when the two client values are missing.

## 5. Deploy server functions when ready

These deployment steps are for the **new development/staging project only** and were not run in this task. After linking the project and applying migrations:

```bash
npx supabase functions deploy delete-account
npx supabase functions deploy register-push-device
npx supabase functions deploy dispatch-push
```

`delete-account` and `register-push-device` require the signed-in user JWT. `dispatch-push` has JWT verification disabled in `supabase/config.toml` because it authenticates a separate random worker secret inside the function. Supabase provides the service-role key in the Edge Function runtime; never add it to client configuration.

### Expo push credentials and scheduled delivery

1. Configure native push credentials for the existing Expo project: APNs credentials for iOS and Firebase Cloud Messaging (FCM) credentials for Android using Expo/EAS secure credential settings. The Expo project ID is already referenced by `app.json`; verify it is the project you intend to use before building.
2. Create a random worker secret locally (for example, `openssl rand -hex 32`) and save it only in **Supabase Dashboard → Edge Functions → Secrets** as `PUSH_WORKER_SECRET`. Optionally set `EXPO_ACCESS_TOKEN` there to authenticate requests to Expo Push. Never commit or share either value.
3. Enable the Supabase `pg_cron`, `pg_net`, and Vault extensions in the development project. Store the dispatcher URL and the same worker secret in Vault using the Dashboard SQL Editor; use a local, uncommitted SQL buffer and replace placeholders there:

```sql
select vault.create_secret('https://YOUR_DEV_PROJECT_REF.supabase.co/functions/v1/dispatch-push', 'catchya_dispatch_url');
select vault.create_secret('PASTE_WORKER_SECRET_LOCALLY_ONLY', 'catchya_dispatch_secret');

select cron.schedule(
  'catchya-dispatch-push',
  '* * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'catchya_dispatch_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'catchya_dispatch_secret')
      ),
      body := '{}'::jsonb
    );
  $$
);
```

Do not save the filled-in SQL file in the repository or put the secret in a client. Verify the scheduled job and Edge Function logs in the Dashboard. Until device credentials and the scheduler work, the app should not be treated as delivering push notifications.

## 6. Provision a moderator

A project owner should provision the first moderator from the Supabase SQL Editor after that person has registered and their `auth.users` row exists. Substitute the account UUIDs locally; do not grant a role through client code:

```sql
insert into private.moderator_roles (user_id, role, granted_by)
values ('MODERATOR_AUTH_USER_UUID', 'admin', 'PROJECT_OWNER_AUTH_USER_UUID');
```

The private table has no client access. After provisioning, the moderator’s Settings screen shows the moderation queue; every queue/action RPC still checks the role server-side and logs decisions.

## 7. Checks and manual test flow

App checks:

```bash
npm run typecheck
npm run lint
npx expo export --platform ios --output-dir /tmp/catchya-ios
npx expo export --platform android --output-dir /tmp/catchya-android
```

Database tests (local Supabase + Docker required):

```bash
npx supabase start
npx supabase db reset
npm run test:db
```

The pgTAP suite covers sign-up profile provisioning, direct-read RLS, opt-in and 15/30/60-minute discovery expiry, private coordinate denial/cleanup, request recipient permissions, accepted-chat access, block/suspension behavior, message/request/report rate limits, token-table ownership, per-user archive behavior, and moderator-only queue/actions. GitHub Actions runs app checks, iOS/Android JS bundle exports, and the local database test job for pull requests and pushes to `main`.

For a configured test project, create two disposable test users and verify:

1. Email sign-up/confirmation/sign-in, profile onboarding, password reset/deep-link update, and Google only after provider setup.
2. Discovery starts off; deny location and confirm it stays off. Allow foreground location, enable each duration, close/reopen across expiry, scan, and verify results contain only an approximate range. Turn off and confirm the location row is removed.
3. Use two opted-in users to confirm mutual meet-preference filtering; QR discovery should work without enabling location.
4. Send a connection request; confirm only its recipient can accept/decline. Before acceptance, no private messages; after acceptance, test Realtime updates, pagination, read/unread state, and safe retry.
5. Hide a conversation and confirm it disappears only for that user while the other participant’s messages remain. Test block/report and moderator actions with separately provisioned roles.
6. Enable notifications on a physical device with APNs/FCM configured, verify delivery/tap routing, disable notification preference, test logout cleanup, then test account deactivation and (only on a disposable account) permanent deletion.

## Current verification and readiness

- **Supabase deployment:** none. No remote project was linked, modified, or deployed.
- **Auth/OAuth, email delivery, push credentials/scheduler, moderator provisioning:** require the secure Dashboard setup above.
- **Automated DB tests/two-account journey/physical push:** require local Docker or a dedicated dev project and native devices. They were not run in this implementation environment.
- **Age policy:** unresolved. The current optional 13–120 age input was preserved; choose the minimum before beta.
- **Private beta:** **not ready yet** until the age policy is decided, the migrations/tests run in a dedicated development project, recovery/email/OAuth are verified, and push setup (if offered) is configured and tested on real iOS/Android devices.
