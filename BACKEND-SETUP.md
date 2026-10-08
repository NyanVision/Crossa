# CatchYa backend: authentication and profiles

Project: `hzqzpvaisxnyixqtzets`, organization `zane.mail.23@icloud.com`.
The existing project is in `eu-west-1`. No new paid project was created.

Implemented: email registration/sign-in, PKCE Google OAuth, session restoration,
email confirmation callbacks, password recovery, saved onboarding, owner-only
profiles and preferences, private avatar uploads, and authenticated account deletion.
The client contains only a publishable key. Never put a service-role key in Expo.

## Required dashboard configuration

1. In Supabase Authentication → URL Configuration, add these redirect URLs:
   - `catchya://auth/callback`
   - `catchya://auth/recovery`
2. Keep email confirmation enabled. Configure production SMTP before opening
   registration to the public; the default email service is restricted.
3. In Google Cloud, create/configure a Web OAuth client. Add this authorized
   redirect URI: `https://hzqzpvaisxnyixqtzets.supabase.co/auth/v1/callback`.
4. In Supabase Authentication → Sign In / Providers → Google, enable Google and
   enter that client ID and secret. Store the secret only in Supabase.
5. Use a development or installed native build (`npm run ios` / `npm run android`)
   for OAuth and email callbacks. Expo Go is not the callback target. This change
   targets iOS and Android; web callbacks require separate URL configuration.

At implementation time email sign-in was enabled, confirmation was required,
and Google was disabled. The connector does not expose Auth configuration writes;
redirect settings, SMTP and Google credentials were not changed.

## Database and function

The profile migration and `delete-account` function have already been deployed
in this project. The migration checked into this branch documents that schema;
do not reapply it blindly. If adopting CLI migration tracking, reconcile the
remote migration version first (`supabase migration list`).

`profiles` is owner-only, including hidden links and private gender preferences.
There is deliberately no cross-user SELECT policy. Future discovery needs a
separate filtered server API that returns only approved public fields.

`avatars` is a private bucket, JPEG/PNG only, maximum 5 MB. Paths start with the
owner UUID. Photos receive one-hour signed URLs when profiles load.
Account deletion verifies the bearer token with Supabase Auth, revokes refresh
sessions, removes photos via the Storage API, then deletes the Auth user and
cascades their profile. Gateway JWT verification is disabled because the function
performs its own live Auth verification (including for asymmetric signing keys).

## Validation completed

- TypeScript and ESLint checks.
- iOS and Android production JavaScript bundle exports.
- Transactional database tests for owner reads/updates and denial of cross-user
  reads, updates, inserts and owner reassignment. Test records rolled back.
- Supabase security advisors: no findings.

See AUTHENTICATION-TESTING.md for the native device checks still required.

## Next backend milestone

Discovery sessions and expiry, approximate nearby queries, message requests,
chat, blocks and reports remain to be connected. Their existing device-local
state is not a live multi-user backend. Do not describe the whole app as ready
for public launch yet. Privacy policy text is still a prototype placeholder.
