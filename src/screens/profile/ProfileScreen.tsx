import React, { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/Button";
import { SignedProfileImage } from "@/components/SignedProfileImage";
import { loadProfile } from "@/services/profileStorage";
import { loadAboutYouPreferences, visibleGenderLabel } from "@/services/aboutYouPreferences";
import type { CurrentUser, SocialPlatform } from "@/types";
import { type Palette, radii } from "@/theme/colors";
import { useTheme, useThemedStyles } from "@/context/AppearanceContext";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "@/navigation/AppTabs";

type Props = NativeStackScreenProps<AppStackParamList, "Profile">;
const platformLabels: Record<SocialPlatform, string> = {
  facebook: "Facebook", telegram: "Telegram", x: "X", tiktok: "TikTok",
  instagram: "Instagram", line: "LINE", whatsapp: "WhatsApp", wechat: "WeChat",
};
const platformIcons: Record<SocialPlatform, keyof typeof Ionicons.glyphMap> = {
  facebook: "logo-facebook", telegram: "paper-plane-outline", x: "logo-twitter",
  tiktok: "musical-notes-outline", instagram: "logo-instagram",
  line: "chatbubble-ellipses-outline", whatsapp: "chatbubble-outline", wechat: "chatbubbles-outline",
};

export function ProfileScreen({ navigation }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { signOut, userId } = useAuth();
  const [profile, setProfile] = useState<CurrentUser | null>(null);
  const [publicGender, setPublicGender] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let active = true;
    Promise.all([loadProfile(userId).catch(() => null), loadAboutYouPreferences(userId).catch(() => null)]).then(([saved, aboutYou]) => {
      if (!active) return;
      setProfile(saved);
      setPublicGender(aboutYou ? visibleGenderLabel(aboutYou) : null);
    });
    return () => { active = false; };
  }, [userId]));

  const visibleLinks = useMemo(
    () => (profile?.links ?? []).filter((link) => !link.hidden && link.handle.trim()),
    [profile?.links]
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.topbar}><Text style={styles.h1}>Your profile</Text><Pressable onPress={() => navigation.navigate("Settings")} style={styles.settingsButton} accessibilityRole="button" accessibilityLabel="Settings"><Ionicons name="settings-outline" size={19} color={colors.text} /></Pressable></View>
      <View style={styles.profileCard}>
        {profile?.photoUri ? <SignedProfileImage path={profile.photoPath} uri={profile.photoUri} style={styles.avatar} accessibilityLabel="Your profile photo" /> : <View style={styles.avatarPlaceholder}><Ionicons name="person" size={27} color={colors.muted} /></View>}
        <View style={styles.identity}><Text style={styles.name}>{profile?.name || "Add your display name"}</Text>{publicGender ? <Text style={styles.gender}>{publicGender}</Text> : null}<Text style={styles.bio} numberOfLines={2}>{profile?.bio || "Add a short bio"}</Text></View>
        <Pressable onPress={() => navigation.navigate("EditProfile")} style={styles.editIcon} accessibilityRole="button" accessibilityLabel="Edit profile"><Ionicons name="create-outline" size={19} color={colors.accent} /></Pressable>
      </View>
      <Button label="Edit profile" variant="primary" onPress={() => navigation.navigate("EditProfile")} style={{ marginBottom: 22 }} />

      <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Contact info</Text><Text style={styles.sharedLabel}>Visible to others</Text></View>
      <View style={styles.contactCard}>
        {visibleLinks.length ? visibleLinks.map((link, index) => <View key={link.platform} style={[styles.contactRow, index > 0 && styles.rowDivider]}>
          <View style={styles.platformIcon}><Ionicons name={platformIcons[link.platform]} size={17} color={colors.text} /></View>
          <View style={{ flex: 1 }}><Text style={styles.platformName}>{platformLabels[link.platform]}</Text><Text style={styles.handle} numberOfLines={1}>{link.handle}</Text></View>
          <Ionicons name="eye-outline" size={16} color={colors.success} />
        </View>) : <View style={styles.emptyContact}><Ionicons name="eye-off-outline" size={18} color={colors.muted} /><Text style={styles.emptyText}>No visible contact links yet</Text></View>}
      </View>

      <Text style={styles.sectionTitle}>Account</Text>
      <Pressable style={styles.accountRow} onPress={() => navigation.navigate("Settings")}><View style={styles.accountIcon}><Ionicons name="shield-checkmark-outline" size={18} color={colors.text} /></View><View style={{ flex: 1 }}><Text style={styles.accountTitle}>Privacy & discovery</Text><Text style={styles.accountDescription}>Control visibility, blocking, and reporting</Text></View><Ionicons name="chevron-forward" size={17} color={colors.muted} /></Pressable>
      <Button label="Sign out" onPress={signOut} style={{ marginTop: 20 }} />
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 32 },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 15 },
  h1: { fontSize: 20, fontWeight: "800", color: colors.text },
  settingsButton: { width: 36, height: 36, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  profileCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: 12 },
  avatar: { width: 62, height: 62, borderRadius: 21, backgroundColor: colors.borderSoft },
  avatarPlaceholder: { width: 62, height: 62, borderRadius: 21, backgroundColor: colors.borderSoft, alignItems: "center", justifyContent: "center" },
  identity: { flex: 1 },
  name: { fontSize: 15, fontWeight: "800", color: colors.text },
  gender: { fontSize: 10.5, fontWeight: "700", color: colors.muted, marginTop: 2 },
  bio: { fontSize: 12, color: colors.muted, marginTop: 3 },
  editIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center" },
  sectionHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: colors.text, marginBottom: 8 },
  sharedLabel: { color: colors.muted, fontSize: 10.5 },
  contactCard: { paddingHorizontal: 12, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: 20 },
  contactRow: { minHeight: 57, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.borderSoft },
  platformIcon: { width: 33, height: 33, borderRadius: 10, backgroundColor: colors.borderSoft, alignItems: "center", justifyContent: "center" },
  platformName: { color: colors.text, fontSize: 11.5, fontWeight: "800" },
  handle: { color: colors.muted, fontSize: 11, marginTop: 2 },
  emptyContact: { minHeight: 62, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8 },
  emptyText: { color: colors.muted, fontSize: 11.5 },
  accountRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md },
  accountIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.borderSoft, alignItems: "center", justifyContent: "center" },
  accountTitle: { color: colors.text, fontSize: 12.5, fontWeight: "800" },
  accountDescription: { color: colors.muted, fontSize: 10.5, marginTop: 2 },
});
