import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { type Palette } from "@/theme/colors";
import { useThemedStyles } from "@/context/AppearanceContext";

const sections: Array<{ title: string; body: string }> = [
  {
    title: "About this notice",
    body: "This is a product-specific explanation of how the current CatchYa app is designed to use information. It is not a legally reviewed privacy policy or legal advice. The service operator should review this notice, retention periods, age rules, consent and support contacts for the jurisdictions where CatchYa is offered before release.",
  },
  {
    title: "Account and profile",
    body: "CatchYa uses Supabase Auth for account sign-in. Depending on the providers enabled by the operator, this may include your email address and an authentication-provider identifier. Your profile may contain a display name, profile photo, short bio and optional age. Age is self-declared, is not verified by CatchYa, and may be shown to other users when your profile is shown. The current implementation permits ages 13–120; the minimum-age policy is still a product decision.",
  },
  {
    title: "Gender, preferences and social links",
    body: "Gender and the people you want to meet are stored as profile preferences. Gender is not shown unless you choose to display it. The people-you-want-to-meet choices are private and filter your own discovery results. Facebook, Telegram, X, TikTok, Instagram, LINE, WhatsApp and WeChat are optional profile links—not sign-in providers. A social link is shared only when you add it and mark it visible.",
  },
  {
    title: "Nearby discovery and location",
    body: "Nearby discovery is off until you turn it on and confirm a 15-minute, 30-minute or 1-hour session. While it is active, CatchYa requests foreground location to find other people who have also opted in and whose private discovery preferences are compatible. The app sends the location fix to the CatchYa backend for distance calculation. Exact coordinates are held in a private database area and are not returned to other users; profile results show only a coarse range such as within 1 km, 1–3 km, 3–5 km or 5+ km. Turning discovery off clears the stored fix. Sessions expire using the server clock; the Supabase scheduled cleanup included with the migrations removes expired location rows even if the app is closed. Do not grant background-location access for this feature.",
  },
  {
    title: "QR discovery",
    body: "A CatchYa profile QR code contains an opaque server-issued lookup token rather than a location. Scanning it can reveal the profile fields and visible contact links that the owner has chosen to share. QR lookup does not reveal exact coordinates and is separate from nearby-discovery opt-in.",
  },
  {
    title: "Requests, conversations and safety",
    body: "CatchYa stores connection requests and messages so the participants can use the service. A private conversation is available only after the recipient accepts the request. Blocking prevents further requests and chat access between the two accounts. Reports are stored for review by authorized moderators; moderators may record a decision or suspend an account. Do not include passwords, payment details or other sensitive information in messages.",
  },
  {
    title: "Push notifications",
    body: "If you enable push notifications and grant operating-system permission, CatchYa registers an Expo push token and an installation identifier for this device. Notifications are sent through the configured Expo Push service and, depending on the app build, Apple Push Notification service or Firebase Cloud Messaging. Notification text is intentionally minimal and does not include private message content. You can disable notifications in CatchYa settings; the account preference suppresses delivery and the app asks the server to remove the device token.",
  },
  {
    title: "Appearance and settings",
    body: "Appearance, notification, and other account preferences are stored with your CatchYa account. Appearance is also cached on your device so the selected Light, Dark or System theme can be applied promptly when the app opens.",
  },
  {
    title: "Deactivate or delete",
    body: "Deactivation hides your profile, turns discovery and push notifications off, and retains account data so the account can be reactivated by signing in again. Permanent deletion is a separate action. The app calls an authenticated Supabase Edge Function to remove your profile-photo objects and Auth account; related profile, request, message, preference and safety records are removed through database relationships. Deletion may be delayed or incomplete if the operator has not deployed the Edge Function or configured its server-side secrets. Copies in provider backups may follow the provider’s backup-retention schedule.",
  },
  {
    title: "Service providers and configuration",
    body: "Account, profile, location, request and conversation data are processed by the Supabase project selected by the CatchYa operator. Google sign-in, email delivery, Expo Push, APNs and FCM depend on the operator’s provider configuration. Those services may process data as described in their own notices. This screen does not claim that any provider is enabled in a particular deployment.",
  },
];

export function PrivacyPolicyScreen() {
  const styles = useThemedStyles(makeStyles);
  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text style={styles.title}>How CatchYa uses information</Text>
      <Text style={styles.updated}>Product disclosure · Review before public release</Text>
      {sections.map((section) => <View style={styles.section} key={section.title}>
        <Text style={styles.heading}>{section.title}</Text>
        <Text style={styles.body}>{section.body}</Text>
      </View>)}
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  wrap: { padding: 20, paddingBottom: 36, backgroundColor: colors.background },
  title: { color: colors.text, fontSize: 20, fontWeight: "800" },
  updated: { color: colors.muted, fontSize: 11, marginTop: 5, marginBottom: 18 },
  section: { marginBottom: 15 },
  heading: { color: colors.text, fontSize: 13, fontWeight: "800", marginBottom: 4 },
  body: { fontSize: 12.5, color: colors.muted, lineHeight: 19 },
});
