export type SocialPlatform = "facebook" | "telegram" | "x" | "tiktok" | "instagram" | "line" | "whatsapp" | "wechat";

export interface SocialLink {
  platform: SocialPlatform;
  handle: string;
  hidden: boolean;
}

export interface CurrentUser {
  id: string;
  name: string;
  age: number | null;
  bio: string;
  photoUri: string | null;
  /** Private Storage object path; never display this value as a URL. */
  photoPath: string | null;
  links: SocialLink[];
  discoveryEnabled: boolean;
}

export interface Person {
  id: string;
  name: string;
  initials: string;
  color: string;
  distanceLabel: string;
  bio: string;
  tags: string[];
  links: SocialLink[];
}

export interface MessageRequest {
  id: string;
  name: string;
  initials: string;
  color: string;
  preview: string;
  time: string;
}

export interface ChatMessage {
  id: string;
  from: "me" | "them";
  text: string;
  createdAt?: string;
}

export interface Chat {
  id: string;
  name: string;
  initials: string;
  color: string;
  unread: boolean;
  messages: ChatMessage[];
}

export type ContactPlatform = SocialPlatform;

export interface PublicContactLink {
  platform: ContactPlatform;
  value: string;
  visible: boolean;
}

export interface PublicProfile {
  id: string;
  displayName: string;
  age: number | null;
  photoUrl: string | null;
  /** Private Storage object path for refreshing expiring signed URLs. */
  photoPath?: string | null;
  distanceRange: string;
  contactLinks: PublicContactLink[];
  /** Present only when the profile owner explicitly chose to show their gender. */
  genderLabel?: string | null;
}

export type InboxStatus = "chat" | "request";

export interface InboxConversation {
  id: string;
  profileId: string;
  displayName: string;
  photoUri: string | null;
  /** Private Storage path used only to renew signed URLs; never show it as a URL. */
  photoPath?: string | null;
  lastMessage: string;
  updatedAt: string;
  unreadCount: number;
  status: InboxStatus;
  messages: ChatMessage[];
  firstMessage?: string;
  profilePreview?: { bio?: string; distanceRange?: string; interests?: string[] };
}
