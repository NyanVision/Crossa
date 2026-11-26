# Crossa release preparation

## Database history

The repository includes the six migrations currently applied to Crossa, including
`20261125142517_fix_nearby_profiles_conflict_target.sql`. That file preserves the
hosted repair instead of relying on an unrecorded manual database edit. Its
regression test enables discovery for two accounts and repeats a nearby scan to
exercise the repaired profile-grant conflict clause.

The two later messaging/scheduler migrations are pending, not already deployed.
Apply them and deploy their matching functions before installing the new app.
After future hosted migrations, record the exact applied SQL/version in this
directory and replay the complete history in tests.

## Privacy policy

The in-app notice is available before signup and at **Settings → Privacy Policy**.
It describes actual account/profile data, foreground coordinates, QR access,
chat access (without an end-to-end encryption claim), reports, notifications,
providers, retention, deletion, and user controls.

Set a public support address you control in `EXPO_PUBLIC_PRIVACY_CONTACT_EMAIL`.
No personal address has been guessed or published. To produce a public HTML
copy from the same policy content, run:

```sh
npm run privacy:export
```

Publish the resulting `docs/privacy.html` to your public HTTPS hosting, then
set `EXPO_PUBLIC_PRIVACY_POLICY_URL` to that actual page. The exporter refuses
to create a public notice without a real contact address. Hosting and store
metadata must use the same operator/contact and describe the actual audience.
Complete the store age/audience, safety, privacy, and data-safety declarations
against the final app; this text is not a claim of regulatory or store approval.

## Build profiles

| Profile | Purpose |
|---|---|
| `development` | Native development client with OAuth deep links |
| `ios-simulator` | iOS Simulator development build |
| `preview` | Internal distribution; Android APK |
| `production` | Signed store archive; Android AAB and iOS Release |

All profiles preserve the existing bundle/package IDs, OAuth scheme, and Expo
project. Production uses Expo-managed credentials and remote build-number
incrementing. Commit code before an Expo build; the profile requires it.

```sh
npm run build:ios-simulator
npm run build:preview
npm run build:production
```

These commands request builds on the existing Expo account; they are not run
by CI and are separate from JavaScript bundle exports. Use the account that
owns the existing project and its existing upload/signing credentials. Do not
create replacement production keys for an already distributed app.

## Signing

Android Release no longer falls back to `debug.keystore`. Expo injects the
managed release credentials before Gradle starts. A task-graph check rejects
missing signing settings and the default debug key for release artifacts.
Debug builds keep their normal development signing.

For local Android Release builds, supply these outside source control:

```dotenv
CROSSA_ANDROID_KEYSTORE_PATH=/absolute/path/to/the-existing-upload-key.jks
CROSSA_ANDROID_KEYSTORE_PASSWORD=...
CROSSA_ANDROID_KEY_ALIAS=...
CROSSA_ANDROID_KEY_PASSWORD=...
```

Use your local environment or ignored Gradle user properties. Keystores,
`credentials.json`, generated Expo signing files, passwords, Apple signing
keys and provisioning profiles must never be committed. iOS store builds need
the app owner's Apple distribution/provisioning credentials through Expo.

## Production preflight

The `eas-build-pre-install` hook checks production builds. Development, preview,
and simulator workflows remain usable while release details are being set up.
Set these values in the Expo **production** environment:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_PRIVACY_CONTACT_EMAIL`
- `EXPO_PUBLIC_PRIVACY_POLICY_URL`
- `CROSSA_RELEASE_DEVICE_CHECKS=confirmed`, only after the checks below pass

The public values are bundled into the app. Never substitute a service-role
key or server secret. Run `npm run release:check` locally with the equivalent
environment to review missing values without printing them.

On physical iOS and Android devices, verify email/Google signup and login,
password reset on cold/warm launch, discovery/permission denial/expiry, QR,
requests/acceptance/cancellation/cooldowns, chat reconnect/retry/receipts,
push delivery/taps/opt-out/logout/account switching, block/report/admin review,
deactivation, and permanent deletion using disposable accounts.

**Known release blocker from the backend audit:** the currently deployed
account-deletion function cleans the older `avatars` bucket while the app
uploads to `profile-photos`. Correct the deployed cleanup and test account/photo
deletion before public release. Do not mark the device checks confirmed while
this or the pending backend deployment remains unresolved.

The native projects and config plugins disable unused microphone, motion,
and background-location permission descriptions. Installing a new native build
is required for permission/signing changes. A JavaScript export does not
verify a signed native binary, store acceptance, or real push delivery.

References: [Expo build configuration](https://docs.expo.dev/eas/json/),
[Android signing injection](https://docs.expo.dev/build-reference/android-builds/),
[Apple privacy guidance](https://developer.apple.com/app-store/review/guidelines/#privacy),
[Google Play user data](https://support.google.com/googleplay/android-developer/answer/10144311).
