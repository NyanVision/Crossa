import React, { useMemo, useState } from "react";
import { Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "@/components/Button";
import { createMessageRequest } from "@/services/messageRequests";
import { isProfileBlocked, recordProfileReport, setProfileBlocked } from "@/services/profileSafety";
import type { ContactPlatform, PublicContactLink } from "@/types";
import { socialProfileUrl } from "@/services/socialLinks";
import { type Palette, radii } from "@/theme/colors";
import { useTheme, useThemedStyles } from "@/context/AppearanceContext";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "@/navigation/AppTabs";

type Props = NativeStackScreenProps<AppStackParamList, "ProfileDetail">;

const PLATFORM_LABEL: Record<ContactPlatform, string> = {
  facebook: "Facebook", telegram: "Telegram", x: "X", tiktok: "TikTok",
  instagram: "Instagram", line: "LINE", whatsapp: "WhatsApp", wechat: "WeChat",
};
const PLATFORM_ICON: Record<ContactPlatform, keyof typeof Ionicons.glyphMap> = {
  facebook: "logo-facebook", telegram: "paper-plane-outline", x: "logo-twitter",
  tiktok: "musical-notes-outline", instagram: "logo-instagram",
  line: "chatbubble-ellipses-outline", whatsapp: "chatbubble-outline", wechat: "chatbubbles-outline",
};
const getPlatformColor = (colors: Palette): Record<ContactPlatform, string> => ({
  facebook: "#1877F2", telegram: "#229ED9", x: colors.text, tiktok: colors.text,
  instagram: "#C13584", line: "#06C755", whatsapp: "#25D366", wechat: "#07C160",
});

export function ProfileDetailScreen({ route }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const PLATFORM_COLOR = getPlatformColor(colors);
  const profile = route.params.profile;
  const [blocked, setBlocked] = useState(false);
  const [requestSent, setRequestSent] = useState(false);

  React.useEffect(() => {
    isProfileBlocked(profile.id).then(setBlocked).catch(() => setBlocked(false));
  }, [profile.id]);
  const contactLinks = useMemo(
    () => (profile.contactLinks ?? []).filter((link) => link.visible && link.value.trim().length > 0),
    [profile.contactLinks]
  );

  const openContact = async (link: PublicContactLink) => {
    const url = socialProfileUrl(link.platform, link.value);
    if (!url) { Alert.alert("Invalid account link", "This account link could not be validated. Ask the profile owner to update it."); return; }
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert("Couldn’t open this account", "Check that the link or username is correct.");
    }
  };

  const sendRequest = async () => {
    try {
      const created = await createMessageRequest(profile.id, profile.displayName);
      setRequestSent(true);
      Alert.alert(created ? "Request saved" : "Request already saved", created
        ? `Your connection request to ${profile.displayName} has been sent.`
        : `You already have an active request or connection with ${profile.displayName}.`);
    } catch {
      Alert.alert("Request not sent", "Please try again.");
    }
  };

  const reportProfile = () => Alert.alert(
    "Report profile?",
    `Report ${profile.displayName} for review?`,
    [{ text: "Cancel", style: "cancel" }, { text: "Report", style: "destructive", onPress: async () => {
      try {
        await recordProfileReport(profile.id);
        Alert.alert("Report saved", "Your report has been submitted for review.");
      } catch {
        Alert.alert("Report not saved", "Please try again.");
      }
    } }]
  );

  const toggleBlock = () => {
    const nextBlocked = !blocked;
    setProfileBlocked(profile.id, nextBlocked, profile.displayName).then(() => {
      setBlocked(nextBlocked);
      Alert.alert(nextBlocked ? "Profile blocked" : "Profile unblocked", nextBlocked
        ? `${profile.displayName} is blocked and their CatchYa requests and chats will no longer be available.`
        : `${profile.displayName} is unblocked.`);
    }).catch(() => Alert.alert("Couldn’t update block status", "Please try again."));
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.profileHeader}>
        {profile.photoUrl ? <Image source={{ uri: profile.photoUrl }} style={styles.photo} accessibilityLabel={`${profile.displayName}'s profile photo`} /> : <View style={styles.photoFallback}><Ionicons name="person" size={34} color={colors.muted} /></View>}
        <Text style={styles.name}>{profile.displayName}</Text>
        {profile.age !== null ? <Text style={styles.genderLabel}>{profile.age}</Text> : null}
        {profile.genderLabel ? <Text style={styles.genderLabel}>{profile.genderLabel}</Text> : null}
        <View style={styles.distancePill}><Ionicons name="radio-outline" size={13} color={colors.muted} /><Text style={styles.distance}>{profile.distanceRange}</Text></View>
      </View>

      <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Contact info</Text><Text style={styles.sectionCaption}>Shared by {profile.displayName}</Text></View>
      <View style={styles.contactCard}>
        {contactLinks.length ? contactLinks.map((link, index) => (
          <Pressable key={`${link.platform}-${index}`} style={[styles.contactRow, index > 0 && styles.rowDivider]} onPress={() => openContact(link)} accessibilityRole="button" accessibilityLabel={`Open ${PLATFORM_LABEL[link.platform]}`}>
            <View style={[styles.platformIcon, { backgroundColor: `${PLATFORM_COLOR[link.platform]}14` }]}><Ionicons name={PLATFORM_ICON[link.platform]} size={19} color={PLATFORM_COLOR[link.platform]} /></View>
            <View style={styles.contactText}><Text style={styles.platformName}>{PLATFORM_LABEL[link.platform]}</Text><Text style={styles.accountValue} numberOfLines={1}>{link.value}</Text></View>
            <Ionicons name="open-outline" size={17} color={colors.muted} />
          </Pressable>
        )) : <View style={styles.noContacts}><Ionicons name="lock-closed-outline" size={17} color={colors.muted} /><Text style={styles.noContactsText}>No contact accounts shared</Text></View>}
      </View>

      <Button label={requestSent ? "Request saved" : "Message"} variant="primary" disabled={blocked || requestSent} icon={<Ionicons name="chatbubble-outline" size={17} color={colors.accentInk} />} onPress={sendRequest} style={styles.messageButton} />
      <View style={styles.safetyActions}>
        <Pressable onPress={toggleBlock} style={styles.safetyButton} accessibilityRole="button"><Ionicons name={blocked ? "checkmark-circle-outline" : "ban-outline"} size={17} color={blocked ? colors.success : colors.danger} /><Text style={[styles.safetyText, blocked && { color: colors.success }]}>{blocked ? "Unblock" : "Block"}</Text></Pressable>
        <View style={styles.actionDivider} />
        <Pressable onPress={reportProfile} style={styles.safetyButton} accessibilityRole="button"><Ionicons name="flag-outline" size={17} color={colors.muted} /><Text style={styles.safetyText}>Report</Text></Pressable>
      </View>
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 34 },
  profileHeader: { alignItems: "center", paddingTop: 16, paddingBottom: 26 },
  photo: { width: 104, height: 104, borderRadius: 36, backgroundColor: colors.borderSoft, marginBottom: 13 },
  photoFallback: { width: 104, height: 104, borderRadius: 36, backgroundColor: colors.borderSoft, alignItems: "center", justifyContent: "center", marginBottom: 13 },
  name: { color: colors.text, fontSize: 22, fontWeight: "800" },
  genderLabel: { color: colors.muted, fontSize: 12, fontWeight: "600", marginTop: 4 },
  distancePill: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 7, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.pill, backgroundColor: colors.borderSoft },
  distance: { color: colors.muted, fontSize: 11.5, fontWeight: "600" },
  sectionHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 9 },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: "800" },
  sectionCaption: { color: colors.muted, fontSize: 11 },
  contactCard: { paddingHorizontal: 13, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: 18 },
  contactRow: { flexDirection: "row", alignItems: "center", gap: 11, minHeight: 66, paddingVertical: 10 },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.borderSoft },
  platformIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  contactText: { flex: 1, minWidth: 0 },
  platformName: { color: colors.text, fontSize: 13, fontWeight: "700" },
  accountValue: { color: colors.muted, fontSize: 12, marginTop: 3 },
  noContacts: { minHeight: 68, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  noContactsText: { color: colors.muted, fontSize: 12.5 },
  messageButton: { marginTop: 2 },
  safetyActions: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 26, marginTop: 18 },
  safetyButton: { flexDirection: "row", alignItems: "center", gap: 7, padding: 8 },
  safetyText: { color: colors.text, fontSize: 12.5, fontWeight: "700" },
  actionDivider: { height: 22, width: 1, backgroundColor: colors.border },
});
