# Crossa authentication and backend testing

Crossa now uses Supabase Auth rather than the former device-only test-account store. Follow the Supabase setup, email/Google provider instructions, environment configuration, and manual test checklist in [README.md](README.md#backend-features-and-privacy).

Quick start:

1. Create a Supabase project and apply the migration with `npx supabase link --project-ref YOUR_PROJECT_REF` and `npx supabase db push`.
2. Configure email/password and, if desired, Google OAuth in Supabase Auth. Add `catchya://auth/callback` to the Supabase redirect allow-list.
3. Copy `.env.example` to `.env`, set only the project URL and publishable key, and restart Expo.
4. Run `npm run typecheck`, `npm run lint`, then follow the manual test checklist in README.
5. To run pgTAP database permission tests locally, install Docker, then run `npx supabase start`, `npx supabase db reset`, and `npx supabase test db`.

Google OAuth requires a configured Supabase Google provider and a native development build with the Crossa URL scheme. Social profile links are data only and are not authentication methods.

The former local test-auth implementation is no longer used by the app. Do not enter service-role keys in Expo variables or client code.
