import React, { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect } from "@react-navigation/native";
import { useDiscoveryExpiry } from "@/hooks/useDiscoveryExpiry";
import { useAuth } from "@/context/AuthContext";
import { useAppAppearance, type AppearanceChoice } from "@/context/AppearanceContext";
import { registerForPushNotifications } from "@/services/notifications";
import { loadProfile } from "@/services/profileStorage";
import { emptyAboutYouPreferences, loadAboutYouPreferences, visibleGenderLabel, type AboutYouPreferences } from "@/services/aboutYouPreferences";
import { loadDiscoveryPreferences, saveDiscoveryPreferences, type DiscoveryPreferences, type VisibilityDuration } from "@/services/discoveryPreferences";
import { loadBlockedProfiles, setProfileBlocked, type BlockedProfile } from "@/services/profileSafety";
import { requestLocationPermission } from "@/services/location";
import type { CurrentUser, SocialPlatform } from "@/types";
import { type Palette, radii } from "@/theme/colors";
import { useTheme, useThemedStyles } from "@/context/AppearanceContext";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "@/navigation/AppTabs";

type Props = NativeStackScreenProps<AppStackParamList, "Settings">;
const durations: VisibilityDuration[] = ["15 minutes", "30 minutes", "1 hour"];
const platformLabels: Record<SocialPlatform, string> = {
  facebook: "Facebook", telegram: "Telegram", x: "X", tiktok: "TikTok",
  instagram: "Instagram", line: "LINE", whatsapp: "WhatsApp", wechat: "WeChat",
};

export function SettingsScreen({ navigation }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const { userId, signOut, deleteAccount } = useAuth();
  const { choice: appearanceChoice, setChoice: setAppearanceChoice } = useAppAppearance();
  const [profile, setProfile] = useState<CurrentUser | null>(null);
  const [aboutYou, setAboutYou] = useState<AboutYouPreferences>(emptyAboutYouPreferences());
  const [discovery, setDiscovery] = useState<DiscoveryPreferences>({ enabled: false, duration: "15 minutes", expiresAt: null });
  const [blockedProfiles, setBlockedProfiles] = useState<BlockedProfile[]>([]);
  const [notificationsOn, setNotificationsOn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const [showDiscoveryDurationPicker, setShowDiscoveryDurationPicker] = useState(false);
  const [draftDiscoveryDuration, setDraftDiscoveryDuration] = useState<VisibilityDuration>("15 minutes");

  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    const notificationKey = `catchya:notificationsEnabled:${userId ?? "local"}`;
    Promise.all([
      loadProfile(userId).catch(() => null),
      loadDiscoveryPreferences(userId).catch(() => ({ enabled: false, duration: "15 minutes" as const, expiresAt: null })),
      loadBlockedProfiles().catch(() => []),
      loadAboutYouPreferences(userId).catch(() => emptyAboutYouPreferences()),
      AsyncStorage.getItem(notificationKey).catch(() => null),
    ]).then(([savedProfile, savedDiscovery, savedBlocked, savedAboutYou, savedNotifications]) => {
      if (!active) return;
      setProfile(savedProfile);
      setDiscovery(savedDiscovery);
      setBlockedProfiles(savedBlocked);
      setAboutYou(savedAboutYou);
      setNotificationsOn(savedNotifications === "true");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId]));

  useDiscoveryExpiry(userId, discovery.expiresAt, setDiscovery);

  const toggleDiscovery = async (enabled: boolean) => {
    if (discoveryBusy) return;
    if (!enabled) {
      setDiscoveryBusy(true);
      setDiscovery((current) => ({ ...current, enabled: false, expiresAt: null }));
      try { await saveDiscoveryPreferences(userId, false, discovery.duration); }
      catch { Alert.alert("Couldn’t turn off discovery", "Your change could not be saved. Reopen this screen and retry."); }
      finally { setDiscoveryBusy(false); }
      return;
    }
    setDraftDiscoveryDuration(discovery.duration);
    setShowDiscoveryDurationPicker(true);
  };

  const enableDiscoveryFor = async (duration: VisibilityDuration) => {
    if (discoveryBusy) return;
    setDiscoveryBusy(true);
    try {
      const permission = await requestLocationPermission();
      if (permission !== "granted") {
        Alert.alert("Location permission needed", "Nearby discovery uses foreground location to find opted-in people and show an approximate distance range. CatchYa never displays your exact location.", [
          { text: "Not now", style: "cancel" },
          { text: "Open Settings", onPress: () => { void Linking.openSettings(); } },
        ]);
        return;
      }
      setDiscovery(await saveDiscoveryPreferences(userId, true, duration));
      setShowDiscoveryDurationPicker(false);
    } catch {
      Alert.alert("Couldn’t update discovery", "Please try again.");
    } finally {
      setDiscoveryBusy(false);
    }
  };

  const chooseDuration = async (duration: VisibilityDuration) => {
    if (discoveryBusy || loading) return;
    setDiscoveryBusy(true);
    try {
      setDiscovery(await saveDiscoveryPreferences(userId, discovery.enabled, duration));
    } catch {
      Alert.alert("Couldn’t save duration", "Please try again.");
    } finally { setDiscoveryBusy(false); }
  };

  const toggleNotifications = async (enabled: boolean) => {
    const key = `catchya:notificationsEnabled:${userId ?? "local"}`;
    if (!enabled) {
      setNotificationsOn(false);
      await AsyncStorage.setItem(key, "false");
      return;
    }
    try {
      const token = await registerForPushNotifications();
      setNotificationsOn(!!token);
      await AsyncStorage.setItem(key, token ? "true" : "false");
      if (!token) {
        Alert.alert("Notifications unavailable", "Enable notifications for CatchYa in your device settings. Push notification delivery also needs a configured app service.", [
          { text: "Open Settings", onPress: () => { void Linking.openSettings(); } },
          { text: "Cancel", style: "cancel" },
        ]);
      }
    } catch {
      Alert.alert("Couldn’t enable notifications", "Please try again or check your device settings.");
    }
  };

  const unblock = async (person: BlockedProfile) => {
    try {
      await setProfileBlocked(person.profileId, false);
      setBlockedProfiles((current) => current.filter((item) => item.profileId !== person.profileId));
    } catch {
      Alert.alert("Couldn’t unblock account", "Please try again.");
    }
  };

  const confirmSignOut = () => Alert.alert("Sign out of CatchYa?", "You can sign back in at any time.", [
    { text: "Cancel", style: "cancel" },
    { text: "Sign out", style: "destructive", onPress: () => { void signOut().catch(() => Alert.alert("Could not sign out", "Check your connection and try again.")); } },
  ]);

  const confirmDelete = () => Alert.alert("Delete your account?", "This removes your saved profile, chats, requests, and safety data from this device. In this demo, account deletion is local; deleting an online account requires a connected account service.", [
    { text: "Cancel", style: "cancel" },
    { text: "Delete account", style: "destructive", onPress: async () => {
      try { await deleteAccount(); }
      catch { Alert.alert("Couldn’t delete account", "Please try again."); }
    } },
  ]);

  const visibleLinks = (profile?.links ?? []).filter((link) => !link.hidden && link.handle.trim().length > 0);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.pageHeading}><Text style={styles.subtitle}>Control what you share and when people can find you.</Text></View>

      <SectionHeading title="Appearance" />
      <View style={styles.card}>
        <Text style={styles.rowDescription}>Choose Light or Dark, or follow your device with System default.</Text>
        <View style={[styles.appearanceChoices, (windowWidth <= 430 || fontScale > 1.2) && styles.appearanceChoicesNarrow]}>{(["light", "dark", "system"] as AppearanceChoice[]).map((option) => {
          const selected = appearanceChoice === option;
          const label = option === "system" ? "System default" : option[0].toUpperCase() + option.slice(1);
          return <Pressable key={option} onPress={() => void setAppearanceChoice(option)} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`${label} appearance`} style={[styles.appearanceOption, (windowWidth <= 430 || fontScale > 1.2) && styles.appearanceOptionNarrow, selected && styles.appearanceSelected]}><Ionicons name={option === "light" ? "sunny-outline" : option === "dark" ? "moon-outline" : "phone-portrait-outline"} size={17} color={selected ? colors.accent : colors.muted} /><Text style={[styles.appearanceLabel, selected && styles.appearanceLabelSelected]}>{label}</Text></Pressable>;
        })}</View>
      </View>

      <SectionHeading title="Edit Profile" />
      <View style={styles.card}>
        <SettingsRow icon="person-circle-outline" title="Edit your profile" description="Change your photo, name, bio, and contact links" onPress={() => navigation.navigate("EditProfile")} />
      </View>

      <SectionHeading title="Discoverability" caption="Optional · off by default" />
      <View style={styles.card}>
        <View style={styles.switchRow}>
          <View style={styles.leadingIcon}><Ionicons name={discovery.enabled ? "eye-outline" : "eye-off-outline"} size={18} color={discovery.enabled ? colors.success : colors.accent} /></View>
          <View style={styles.rowCopy}><Text style={styles.rowTitle}>Nearby discovery</Text><Text style={styles.rowDescription}>{discovery.enabled ? "You are visible to other opted-in people nearby." : "You’re not discoverable. Turn this on only when you choose."}</Text></View>
          {loading || discoveryBusy ? <ActivityIndicator color={colors.accent} /> : <Switch value={discovery.enabled} onValueChange={toggleDiscovery} trackColor={{ false: colors.border, true: colors.accent }} thumbColor="#FFFFFF" accessibilityLabel="Nearby discovery" />}
        </View>
        <View style={styles.privacyCallout}><Ionicons name="shield-checkmark-outline" size={16} color={colors.success} /><Text style={styles.calloutText}>Your exact location is never displayed. People see an approximate distance range.</Text></View>
        <View style={styles.durationHeading}><Text style={styles.rowTitle}>Visibility duration</Text><Text style={styles.rowDescription}>{discovery.enabled ? "The timer starts when you save a duration." : "Choose how long discovery stays on."}</Text></View>
        <View style={styles.durationRow}>{durations.map((duration) => {
          const selected = discovery.duration === duration;
          return <Pressable key={duration} onPress={() => void chooseDuration(duration)} disabled={loading || discoveryBusy} accessibilityRole="button" accessibilityState={{ selected, disabled: loading || discoveryBusy }} style={[styles.durationChip, selected && styles.durationChipSelected, (loading || discoveryBusy) && styles.disabledControl]}><Text style={[styles.durationLabel, selected && styles.durationLabelSelected]}>{duration}</Text></Pressable>;
        })}</View>
      </View>

      <SectionHeading title="Privacy" caption="Review what others can see" />
      <View style={styles.card}>
        <View style={styles.privacyIntro}><Ionicons name="eye-outline" size={17} color={colors.accent} /><Text style={styles.privacyIntroText}>Your photo, display name, and bio appear on your profile. Social links appear only when marked visible. Gender stays private unless you choose to show it.</Text></View>
        <SettingsRow icon="people-outline" title="A little about you" description="Gender is private by default; Discover choices stay private" onPress={() => navigation.navigate("AboutYouSettings")} />
        <View style={styles.rowDivider} />
        <View style={styles.previewHeader}>
          {profile?.photoUri ? <Image source={{ uri: profile.photoUri }} style={styles.avatar} accessibilityLabel="Profile photo preview" /> : <View style={[styles.avatar, styles.avatarPlaceholder]}><Ionicons name="person" size={19} color={colors.muted} /></View>}
          <View style={styles.previewIdentity}><Text style={styles.profileName}>{profile?.name?.trim() || "No display name added"}</Text>{visibleGenderLabel(aboutYou) ? <Text style={styles.profileGender}>{visibleGenderLabel(aboutYou)}</Text> : null}<Text style={styles.profileBio} numberOfLines={2}>{profile?.bio?.trim() || "No bio added"}</Text></View>
          <Pressable onPress={() => navigation.navigate("EditProfile")} style={styles.editLink} accessibilityRole="button"><Text style={styles.editLinkText}>Edit</Text></Pressable>
        </View>
        <View style={styles.linkHeading}><Text style={styles.rowTitle}>Visible social links</Text><Text style={styles.linkCount}>{visibleLinks.length}</Text></View>
        {visibleLinks.length ? visibleLinks.map((link) => <View key={link.platform} style={styles.visibleLinkRow}><Ionicons name="link-outline" size={15} color={colors.muted} /><Text style={styles.linkPlatform}>{platformLabels[link.platform]}</Text><Text style={styles.linkHandle} numberOfLines={1}>{link.handle}</Text><Ionicons name="eye-outline" size={14} color={colors.success} /></View>) : <Text style={styles.noLinks}>No social links are visible. Add a link and turn on its visibility in Edit Profile.</Text>}
        <View style={styles.inlineDivider} />
        <Text style={styles.rowTitle}>Blocked users</Text>
        <Text style={styles.rowDescription}>Keep people you block out of your CatchYa interactions.</Text>
        {loading ? <ActivityIndicator color={colors.accent} style={styles.blockLoading} /> : blockedProfiles.length ? blockedProfiles.map((person) => <View key={person.profileId} style={styles.blockedRow}><View style={styles.blockedIcon}><Ionicons name="person" size={14} color={colors.muted} /></View><Text style={styles.blockedName} numberOfLines={1}>{person.displayName}</Text><Pressable onPress={() => void unblock(person)} style={styles.unblockButton} accessibilityRole="button" accessibilityLabel={`Unblock ${person.displayName}`}><Text style={styles.unblockText}>Unblock</Text></Pressable></View>) : <View style={styles.blockedEmpty}><Ionicons name="checkmark-circle-outline" size={16} color={colors.success} /><Text style={styles.noLinks}>No blocked users.</Text></View>}
      </View>

      <SectionHeading title="Notifications" />
      <View style={styles.card}>
        <View style={styles.switchRow}>
          <View style={styles.leadingIcon}><Ionicons name="notifications-outline" size={18} color={colors.text} /></View>
          <View style={styles.rowCopy}><Text style={styles.rowTitle}>Push notifications</Text><Text style={styles.rowDescription}>Get alerts for message requests and chats.</Text></View>
          <Switch value={notificationsOn} onValueChange={toggleNotifications} trackColor={{ false: colors.border, true: colors.accent }} thumbColor="#FFFFFF" accessibilityLabel="Push notifications" />
        </View>
      </View>

      <SectionHeading title="Account" />
      <View style={styles.card}>
        <SettingsRow icon="log-out-outline" title="Log out" description="Sign out on this device" onPress={confirmSignOut} />
        <View style={styles.rowDivider} />
        <SettingsRow icon="trash-outline" title="Delete account" description="Remove your saved CatchYa data from this device" destructive onPress={confirmDelete} />
      </View>

      <SectionHeading title="Help" />
      <View style={styles.card}>
        <SettingsRow icon="help-circle-outline" title="Privacy and discovery help" description="Learn how visibility, location, and links work" onPress={() => Alert.alert("Privacy and discovery", "Nearby discovery is optional and starts off. When enabled, only opted-in people can find you, your visibility ends at the duration you select, and your exact location is never displayed. Gender stays private unless you turn on Show this on my profile. Your Discover choices are private and only shape your results. Social links appear only when you add them and mark them visible.", [{ text: "Got it" }])} />
        <View style={styles.rowDivider} />
        <SettingsRow icon="information-circle-outline" title="About CatchYa" description="This starter app stores profile and inbox data on this device" onPress={() => Alert.alert("About CatchYa", "CatchYa’s sign-in, messaging, and account services need a live backend before information can sync between users or account deletion can be completed online.", [{ text: "Done" }])} />
      </View>
      <Modal transparent visible={showDiscoveryDurationPicker} animationType="fade" onRequestClose={() => { if (!discoveryBusy) setShowDiscoveryDurationPicker(false); }}>
        <View style={styles.modalBackdrop}>
          <View style={styles.durationModal}>
            <Text style={styles.modalTitle}>Turn on nearby discovery</Text>
            <Text style={styles.modalCopy}>Choose how long you want to be visible. Discovery will turn off automatically.</Text>
            {durations.map((duration) => {
              const selected = draftDiscoveryDuration === duration;
              return <Pressable key={duration} onPress={() => setDraftDiscoveryDuration(duration)} disabled={discoveryBusy} accessibilityRole="radio" accessibilityState={{ selected }} style={[styles.durationChoice, selected && styles.durationChoiceSelected]}><Text style={[styles.durationChoiceText, selected && styles.durationChoiceTextSelected]}>{duration}</Text><Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={18} color={selected ? colors.accent : colors.muted} /></Pressable>;
            })}
            <View style={styles.modalActions}>
              <Pressable onPress={() => setShowDiscoveryDurationPicker(false)} disabled={discoveryBusy} accessibilityRole="button" style={[styles.modalButton, styles.modalCancel]}><Text style={styles.modalCancelText}>Cancel</Text></Pressable>
              <Pressable onPress={() => void enableDiscoveryFor(draftDiscoveryDuration)} disabled={discoveryBusy} accessibilityRole="button" style={[styles.modalButton, styles.modalConfirm, discoveryBusy && styles.disabledControl]}><Text style={styles.modalConfirmText}>{discoveryBusy ? "Turning on…" : "Confirm"}</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function SectionHeading({ title, caption }: { title: string; caption?: string }) {
  const styles = useThemedStyles(makeStyles);
  return <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{title}</Text>{caption ? <Text style={styles.sectionCaption}>{caption}</Text> : null}</View>;
}

function SettingsRow({ icon, title, description, onPress, destructive = false }: { icon: keyof typeof Ionicons.glyphMap; title: string; description: string; onPress: () => void; destructive?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return <Pressable style={styles.settingsRow} onPress={onPress} accessibilityRole="button">
    <View style={[styles.leadingIcon, destructive && styles.destructiveIcon]}><Ionicons name={icon} size={18} color={destructive ? colors.danger : colors.text} /></View>
    <View style={styles.rowCopy}><Text style={[styles.rowTitle, destructive && styles.destructiveText]}>{title}</Text><Text style={styles.rowDescription}>{description}</Text></View>
    <Ionicons name="chevron-forward" size={16} color={colors.muted} />
  </Pressable>;
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 34 },
  pageHeading: { marginBottom: 14 },
  subtitle: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  sectionHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 10, marginBottom: 7, paddingHorizontal: 2 },
  sectionTitle: { color: colors.text, fontSize: 13.5, fontWeight: "800" },
  sectionCaption: { color: colors.muted, fontSize: 10.5 },
  appearanceChoices: { flexDirection: "row", gap: 7, marginTop: 10 },
  appearanceChoicesNarrow: { flexDirection: "column", gap: 8 },
  appearanceOption: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  appearanceOptionNarrow: { flex: 0, width: "100%", minHeight: 46, justifyContent: "flex-start", paddingHorizontal: 12 },
  appearanceSelected: { borderColor: colors.accent, backgroundColor: colors.borderSoft },
  appearanceLabel: { color: colors.muted, fontSize: 12, fontWeight: "700", flexShrink: 1 },
  appearanceLabelSelected: { color: colors.accent },
  modalBackdrop: { flex: 1, padding: 20, backgroundColor: "rgba(0,0,0,0.48)", alignItems: "center", justifyContent: "center" },
  durationModal: { width: "100%", maxWidth: 420, padding: 18, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  modalTitle: { color: colors.text, fontSize: 17, fontWeight: "800" },
  modalCopy: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 6, marginBottom: 13 },
  durationChoice: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 11, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, marginBottom: 7, backgroundColor: colors.surface },
  durationChoiceSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  durationChoiceText: { color: colors.text, fontSize: 12, fontWeight: "700" },
  durationChoiceTextSelected: { color: colors.accent },
  modalActions: { flexDirection: "row", gap: 8, marginTop: 7 },
  modalButton: { flex: 1, minHeight: 42, borderRadius: radii.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  modalCancel: { backgroundColor: colors.surface, borderColor: colors.border },
  modalCancelText: { color: colors.text, fontSize: 13, fontWeight: "700" },
  modalConfirm: { backgroundColor: colors.accent, borderColor: colors.accent },
  modalConfirmText: { color: colors.accentInk, fontSize: 13, fontWeight: "800" },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, paddingHorizontal: 11, paddingVertical: 7, marginBottom: 5 },
  settingsRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 58, paddingVertical: 8 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 68, paddingVertical: 8 },
  leadingIcon: { width: 35, height: 35, borderRadius: 11, backgroundColor: colors.borderSoft, alignItems: "center", justifyContent: "center" },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.text, fontSize: 12.5, fontWeight: "800" },
  rowDescription: { color: colors.muted, fontSize: 10.5, lineHeight: 15, marginTop: 3 },
  privacyCallout: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginHorizontal: 2, marginBottom: 10, padding: 10, borderRadius: radii.md, backgroundColor: colors.successSoft },
  calloutText: { flex: 1, color: colors.text, fontSize: 10.5, lineHeight: 15 },
  durationHeading: { marginHorizontal: 2, marginBottom: 8 },
  durationRow: { flexDirection: "row", gap: 7, marginBottom: 5 },
  durationChip: { flex: 1, minHeight: 38, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, alignItems: "center", justifyContent: "center", paddingHorizontal: 5, backgroundColor: colors.surface },
  durationChipSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  disabledControl: { opacity: 0.65 },
  durationLabel: { color: colors.muted, fontSize: 10, fontWeight: "700", textAlign: "center" },
  durationLabelSelected: { color: colors.accent },
  privacyIntro: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingTop: 5, paddingBottom: 10 },
  privacyIntroText: { flex: 1, color: colors.muted, fontSize: 10.5, lineHeight: 15 },
  previewHeader: { flexDirection: "row", alignItems: "center", gap: 9, borderTopWidth: 1, borderTopColor: colors.borderSoft, paddingTop: 11, paddingBottom: 12 },
  avatar: { width: 43, height: 43, borderRadius: 15, backgroundColor: colors.borderSoft },
  avatarPlaceholder: { alignItems: "center", justifyContent: "center" },
  previewIdentity: { flex: 1, minWidth: 0 },
  profileName: { color: colors.text, fontSize: 12.5, fontWeight: "800" },
  profileGender: { color: colors.muted, fontSize: 10, fontWeight: "700", marginTop: 2 },
  profileBio: { color: colors.muted, fontSize: 10.5, lineHeight: 14, marginTop: 3 },
  editLink: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: colors.accentSoft },
  editLinkText: { color: colors.accent, fontSize: 10.5, fontWeight: "800" },
  linkHeading: { flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 6 },
  linkCount: { color: colors.muted, fontSize: 10, fontWeight: "700", paddingHorizontal: 6, paddingVertical: 2, borderRadius: radii.pill, backgroundColor: colors.borderSoft },
  visibleLinkRow: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 7 },
  linkPlatform: { color: colors.text, fontSize: 10.5, fontWeight: "700" },
  linkHandle: { color: colors.muted, fontSize: 10.5, flex: 1, textAlign: "right" },
  noLinks: { color: colors.muted, fontSize: 10.5, lineHeight: 15, flex: 1, paddingVertical: 5 },
  inlineDivider: { height: 1, backgroundColor: colors.borderSoft, marginVertical: 10 },
  blockedRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 42, borderTopWidth: 1, borderTopColor: colors.borderSoft },
  blockedIcon: { width: 27, height: 27, borderRadius: 9, backgroundColor: colors.borderSoft, alignItems: "center", justifyContent: "center" },
  blockedName: { flex: 1, color: colors.text, fontSize: 11.5, fontWeight: "700" },
  unblockButton: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: radii.pill, backgroundColor: colors.borderSoft },
  unblockText: { color: colors.accent, fontSize: 10.5, fontWeight: "800" },
  blockedEmpty: { flexDirection: "row", alignItems: "center", gap: 7, paddingTop: 7 },
  blockLoading: { marginVertical: 10 },
  rowDivider: { height: 1, backgroundColor: colors.borderSoft, marginLeft: 45 },
  destructiveIcon: { backgroundColor: colors.dangerSoft },
  destructiveText: { color: colors.danger },
});
