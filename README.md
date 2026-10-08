# CatchYa — React Native / Expo / TypeScript

A single shared codebase for iOS and Android, built with Expo, React Navigation,
and TypeScript. Platform conventions (header styles, tab bar behavior, permission
dialogs) are handled automatically by the navigation and Expo modules below,
with a few explicit `Platform.select` touches where noted in the code.

## What's implemented

- **Navigation** — `@react-navigation/native` with a native stack for auth and
  per-tab stacks, plus a bottom tab bar (`AppTabs.tsx`, `AuthNavigator.tsx`).
- **Authentication** — a text-only welcome screen (`WelcomeScreen.tsx`, no
  photo collage) leading into `expo-auth-session` (Google), email/password,
  account creation, and password reset, all with loading and error states
  (`AuthContext.tsx`, `screens/auth/*`). No phone-number or SMS sign-in.
  Facebook/Telegram/X/TikTok/Instagram are shown as clearly disabled "coming
  soon" options — see below to wire one up for real.
- **Photo uploads** — `expo-image-picker`, with both photo-library and camera
  flows and permission handling (`services/imageUpload.ts`).
- **Location permission** — `expo-location`, foreground-only, used solely to
  compute a broad distance range (`services/location.ts`). No exact
  coordinates are ever displayed.
- **Push notifications** — `expo-notifications` + `expo-device`, with
  Android notification channel setup (`services/notifications.ts`).

All of these packages are Expo-managed and work on both iOS and Android from
one codebase.

## 1. Install prerequisites (one-time, on your computer)

- [Node.js](https://nodejs.org) 20.19 or newer (required by the current Expo SDK)
- `npm install -g expo-cli` is **not** required — this project uses the
  local Expo CLI via `npx`.
- The **Expo Go** app on your phone:
  - iPhone: install "Expo Go" from the App Store.
  - Android: install "Expo Go" from the Google Play Store.

## 2. Install dependencies

```bash
cd catchya-app
npm.cmd install
```

## 3. Run the app

```bash
npx.cmd expo start --tunnel
```

This starts the Expo development server and shows a QR code. The project uses
Expo SDK 57, so use the current Expo Go app on your phone.

### On an Android device
1. Make sure your phone and computer are on the same Wi-Fi network.
2. Open **Expo Go** on your phone and scan the QR code from the terminal
   (Expo Go has a built-in scanner on Android).
3. The app bundles and opens automatically. Reload with a shake gesture →
   "Reload", or press `r` in the terminal.

### On an iPhone
1. Same Wi-Fi network as your computer.
2. Open the iPhone **Camera** app and point it at the QR code — it will
   show a notification to open in Expo Go.
3. The app bundles and opens automatically. Reload with a shake gesture →
   "Reload", or press `r` in the terminal.

### Using simulators/emulators instead of a physical device
- iOS Simulator (macOS + Xcode required): press `i` in the terminal after
  `npx expo start`, or run `npx expo start --ios`.
- Android Emulator (Android Studio required, with a virtual device already
  created): press `a` in the terminal, or run `npx expo start --android`.
- Note: push notifications only work on physical devices, not simulators
  or emulators. Android remote push notifications require a development build;
  Expo Go can test local notifications only (`services/notifications.ts`).

## 4. Testing permission flows

- **Location**: tapping "Turn on discovery" on the Discover tab triggers the
  native OS permission dialog on both platforms.
- **Photos/Camera**: "Choose photo" / "Take photo" during onboarding trigger
  the native photo-library or camera permission dialog.
- **Notifications**: toggling "Push notifications" in Settings requests
  permission and registers for an Expo push token. Android remote push
  notifications require a development build; Expo Go can test local
  notifications only.
- If you deny a permission and want to test the flow again, reset it from
  the OS Settings app: iOS → Settings → CatchYa; Android → Settings → Apps →
  CatchYa → Permissions.

## 5. Supabase authentication and profiles

Email/password accounts, Google OAuth, persistent sessions, password recovery,
private profiles, onboarding preferences and photos now use Supabase.
See [BACKEND-SETUP.md](BACKEND-SETUP.md) for provider configuration and the
remaining device checks. Legacy device-only test accounts are not migrated.
Use an Expo development build for the `catchya://` callback links.

## 6. Nearby discovery backend contract

The app has Supabase authentication and profiles, but no nearby query yet, so radar does not invent
profiles and currently reports that no connected results are available. Before
production use, implement a server-side authenticated query/RPC that accepts a
short-lived location fix and returns only opted-in, unblocked, audience-eligible
profiles. Suggested fields:

- `profiles.id`, `display_name`, `photo_url`
- `discovery.enabled` (false by default), `expires_at`, `location_updated_at`
- A private geospatial cell or coordinates stored with strict RLS/server-only
  access; never include raw coordinates in client responses
- A computed `distance_range` enum (`Within 1 km`, `1–3 km`, `3–5 km`, `5+ km`)
- `social_links`: platform, account value, and explicit visibility flag

The client query should be an authenticated RPC such as
`nearby_profiles(lat, lng, radius_m, now)` that filters `enabled = true`,
`expires_at > now`, recent location, block lists, and private audience rules;
returns only `id`, `display_name`, `photo_url`, `distance_range`, and visible
social links; and never returns coordinates or direction. The server must rate
limit requests, enforce foreground-only short-lived fixes, and delete/expire
location data on the selected timer. Add the matching SDK and RLS policies only
using Supabase; this package currently contains
none. QR discovery remains independent of location.

## 7. Appearance setting

Light, Dark, and System are saved in device storage. The selection updates the
OS appearance override and status bar style and is restored on startup. Screen
components in this source still contain many static light surface styles; a
full per-component color-token migration is needed for every card, input, and
screen to render true dark surfaces consistently.

## 6. Building a real device build (beyond Expo Go)

Expo Go is fine for development. For TestFlight/App Store or Play Store
builds, use [EAS Build](https://docs.expo.dev/build/introduction/):

```bash
npm install -g eas-cli
eas login
eas build:configure
eas build --platform ios
eas build --platform android
```

This requires an Apple Developer account (for iOS) and a Google Play
Console account (for Android) to actually distribute the app.

## Project structure

```
catchya-app/
  App.tsx                    entry point
  app.json                   Expo config, permissions, plugins
  src/
    context/AuthContext.tsx  auth state, Google/email sign-in, onboarding
    navigation/               React Navigation stacks + bottom tabs
    screens/auth/             sign-in, create account, reset password, privacy
    screens/onboarding/       about-you questions + profile setup incl. photo upload
    screens/discover/         discover feed + profile detail (block/report)
    screens/messages/         message requests + chat
    screens/profile/          own profile
    screens/settings/         discovery, privacy, notifications, account, and help controls
    services/                 location, image upload, push notification helpers
    theme/colors.ts           shared design tokens (matches the web prototype)
    data/sampleData.ts        placeholder sample content
```
## Nearby discovery

The Discover screen explains that nearby discovery is optional and off by default before it requests foreground location access. People can choose 15 minutes, 1 hour, or until turned off, or skip without granting location permission. CatchYa displays approximate distance only and never exact location. The Discover list filters out profiles that have not opted in, uses broad distance ranges, and offers interest filters plus a direct QR scan. No sample users are shown. The nearby-profile data source is empty until a live backend is connected, so the screen shows a useful empty state in this starter build. A separate QR flow displays a scannable profile code or scans another code with camera permission only. QR tokens are random identifiers and do not contain email, phone, or location data. Resolving profile details across accounts requires a live profile backend.

## Public profiles

Profile details render only contact links explicitly returned with `visible: true` and a non-empty value. Supported platforms are Facebook, Telegram, X, TikTok, Instagram, LINE, WhatsApp, and WeChat. Message requests, blocks, and reports are stored locally in this demo; sending them across accounts requires a live messaging and moderation backend.

## Edit profile

The Profile tab opens a Supabase-backed profile editor with photo selection/capture, a display name, short bio, and optional social accounts for Facebook, Telegram, X, TikTok, Instagram, LINE, WhatsApp, and WeChat. Each account has its own visibility switch, and the preview shows only non-empty links that are marked visible. No phone number is requested or verified. Profile values and private preferences are stored in Supabase with owner-only access. Photos use private Storage and temporary signed URLs.

## Inbox

The Inbox separates accepted chats and message requests into tabs. It shows profile photo, name, latest message, time, and unread state for each stored conversation. Requests remain separate until accepted. With no messaging backend connected, the local inbox starts empty; incoming conversations must be provided by a backend or persisted inbox record. Row menus include local block and report actions.

## Message requests

Opening an item in Requests shows the sender photo, name, available profile preview, and the first message. The request screen offers Accept, Decline, Block, and Report. Accept changes the record to a private chat; pending requests do not expose a composer, and the local message-write service rejects messages until a record has been accepted. A production messaging backend must enforce this state on the server too.

Accepted chats show the other person's photo and name, timestamped message bubbles, a composer, and a retry action if a send fails. The chat screen does not display location or social account details. Conversations can be blocked or reported from the chat actions menu. The current local demo stores messages on-device; delivery to another user requires a messaging backend.

## Settings

Settings keeps Edit Profile, Discoverability, Privacy, Notifications, Account, and Help in separate sections. Discovery is off by default; enabling it requests foreground location permission, and the selected duration is saved as 15 minutes, 1 hour, or until turned off. The Privacy section previews only profile details and social links marked visible, and lets users unblock accounts. Log out and Delete account are separate actions. Deletion clears the demo data stored on this device; a connected account service is needed to delete a live online account.

## About you

The first onboarding step asks for gender and who the user hopes to meet. Each question can be skipped independently. Gender is private by default, with a separate opt-in to show it on the user's profile. Meeting choices are stored privately and never added to public profile data. Discover applies those choices to results; a live backend should compute the audience match without returning other users' private gender. Users can change these answers later from Settings.

The current demo has no live nearby-profile source, so the Discover feed remains empty until one is connected. For audience filtering, that source can return a per-viewer `audienceMatch` flag computed server-side from the user's private choices. Only `genderLabel`, when explicitly shared by the profile owner, belongs in public profile data.

## Appearance (Light / Dark / System default)

Settings → Appearance. The choice is stored locally (`catchya:appearance` in AsyncStorage), defaults to
System default, and needs no backend. Colors come from `src/theme/colors.ts` (`lightColors` / `darkColors`);
screens read them through `useTheme()` and `useThemedStyles(makeStyles)` from `src/context/AppearanceContext.tsx`.
Never import a fixed color for UI — use the active palette so every screen follows the selected mode.
# CatchYa
# CatchYa
