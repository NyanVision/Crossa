export const privacyPolicyUpdated = "26 November 2026";
export interface PrivacySection { title: string; paragraphs: string[] }

export function privacyPolicySections(contactEmail = ""): PrivacySection[] {
  const sections: PrivacySection[] = [
    {
      title: "About this notice",
      paragraphs: ["This notice describes how the Crossa app uses information for accounts, profiles, optional nearby discovery, connection requests, private chats, and safety reports."],
    },
    {
      title: "Information you provide",
      paragraphs: ["Crossa uses your account email, account identifier, and sign-in information to authenticate you. If you choose Google sign-in, Google and our authentication provider process that sign-in and provide account information such as your email and account identifier. Crossa does not receive your Google password.",
        "Your profile can include a display name, optional age, photo, bio, gender description, and social account links. Gender and meeting preferences are private unless you separately choose to show your gender. A social account link does not give Crossa access to that account’s password or private messages.",
        "We store connection requests, chat messages and read timestamps, notification preferences, blocks, and reports you submit. A report includes its category and any details you provide; authorized reviewers can add review notes and a review status."],
    },
    {
      title: "Optional nearby discovery and QR codes",
      paragraphs: ["Nearby discovery starts off. When you enable it or scan nearby, Crossa requests foreground location and sends coordinates to its server to compare opted-in profiles. Exact coordinates are kept in a private location table; other users receive approximate distance bands, not your coordinates or a live map.",
        "You choose 15 minutes, 30 minutes, or 1 hour of visibility. Server checks enforce expiry, and location records are cleaned up when you turn discovery off or when expiry cleanup runs. Crossa does not request background location. Your device’s permission settings remain under your control.",
        "Your QR code contains an opaque profile token. A signed-in person who scans it can open the profile information you choose to share, independently of nearby location permission. Avoid sharing your QR code with people you do not want to find your profile."],
    },
    {
      title: "What other people can see",
      paragraphs: ["Eligible people using nearby discovery, or people scanning your QR code, can see the public profile fields and visible social links you share. Hidden links and private meeting preferences are not included in discovery results.",
        "A connection request must be accepted before its participants can use a private chat. Participants can see their conversation, read indicators, and short-lived typing indicators. Private chat means access is restricted to the participants; Crossa does not provide end-to-end encryption.",
        "Blocking restricts further access to requests, chats, and discovery between the two accounts. A person may still keep information or screenshots they received earlier, and a previously issued photo link can remain usable until its short expiry."],
    },
    {
      title: "Photos, camera, and notifications",
      paragraphs: ["Camera and photo access are used when you choose a profile picture, take a photo, or scan a QR code. Uploaded profile photos are stored in a private bucket and displayed through short-lived links. Crossa does not need microphone access for these features.",
        "If you opt into notifications, Crossa stores a push token, a random installation identifier, device platform, and the associated sign-in session. Expo and Apple or Google notification services process delivery. Notification payloads use generic request/message text rather than message previews, profile names, or coordinates. Typing and read information is used only inside the authorized conversation.",
        "You can disable notifications in Crossa or your device settings. Device registration is removed on logout when possible, and invalid or expired sign-in sessions are excluded from delivery. Push delivery records expire and queue history is cleaned up after seven days."],
    },
    {
      title: "Service providers and security",
      paragraphs: ["Supabase provides account authentication, database storage, private photo storage, and realtime services. Expo and the device platform provide push delivery. Google processes a Google sign-in when you choose it. These providers may process technical records such as IP addresses, device/browser information, delivery status, and security logs, including on servers outside your country.",
        "Access rules restrict account, location, conversation, and report data. Authorized Crossa reviewers can access submitted reports for review. This version does not include in-app advertising or a separate third-party analytics SDK. Opening a social profile or another external link also brings you under that service’s privacy practices."],
    },
    {
      title: "Retention and your controls",
      paragraphs: ["Profile and conversation data is retained to provide your account and its features. You can edit your profile, remove social links, change visibility and permissions, block accounts, and turn notifications off. Deactivation hides your account and turns discovery off while retaining data for possible reactivation.",
        "Settings → Delete account requests permanent account deletion. Account-linked database records are removed by account-deletion cascades. Uploaded-file cleanup, provider backups, technical logs, and copies held by other people can have a different retention period; account deletion should not be understood as immediate erasure of every copy everywhere. Contact Crossa about a deletion failure or remaining uploaded data.",
        "Read this notice again after updates: changes to app features or providers may change the information processed. Public releases must publish an updated notice when those practices change."],
    },
  ];
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) sections.push({
    title: "Privacy contact", paragraphs: [`For privacy questions, account-deletion help, or a request about your data, email ${contactEmail}. Do not send your password or sign-in codes.`],
  });
  return sections;
}
