import React, { useCallback, useMemo, useState } from "react";
import { Alert, FlatList, Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useDiscoveryExpiry } from "@/hooks/useDiscoveryExpiry";
import type { DiscoveryPreferences, DiscoveryLocation } from "@/services/discoveryPreferences";
import { Button } from "@/components/Button";
import { filterProfilesByAudience, getDiscoverableProfiles, loadNearbyProfiles, type NearbyProfile } from "@/services/discovery";
import { loadDiscoveryPreferences, saveDiscoveryPreferences } from "@/services/discoveryPreferences";
import { loadAboutYouPreferences, type MeetingOption } from "@/services/aboutYouPreferences";
import { loadBlockedProfiles } from "@/services/profileSafety";
import { requestLocationPermission } from "@/services/location";
import * as Location from "expo-location";
import { useAuth } from "@/context/AuthContext";
import { type Palette, radii } from "@/theme/colors";
import { useTheme, useThemedStyles } from "@/context/AppearanceContext";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "@/navigation/AppTabs";
import type { VisibilityDuration } from "@/services/discoveryPreferences";

type Props = NativeStackScreenProps<AppStackParamList, "Discover">;
const durations: VisibilityDuration[] = ["15 minutes", "30 minutes", "1 hour"];

export function DiscoverScreen({ navigation }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { userId } = useAuth();
  const [discoveryOn, setDiscoveryOn] = useState(false);
  const [selectedDuration, setSelectedDuration] = useState<VisibilityDuration>("15 minutes");
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [draftDuration, setDraftDuration] = useState<VisibilityDuration>("15 minutes");
  const [showDurationPicker, setShowDurationPicker] = useState(false);
  const [savingDiscovery, setSavingDiscovery] = useState(false);
  const [discoveryReady, setDiscoveryReady] = useState(false);
  const [blockedIds, setBlockedIds] = useState<string[]>([]);
  const [meetingPreferences, setMeetingPreferences] = useState<MeetingOption[]>([]);
  const [profiles, setProfiles] = useState<NearbyProfile[]>([]);
  const [radarState, setRadarState] = useState<"idle" | "scanning" | "permission" | "empty" | "error">("idle");

  useFocusEffect(useCallback(() => {
    let active = true;
    setDiscoveryReady(false);
    Promise.all([loadDiscoveryPreferences(userId), loadBlockedProfiles(), loadAboutYouPreferences(userId)]).then(([preferences, blocked, aboutYou]) => {
      if (!active) return;
      setDiscoveryOn(preferences.enabled);
      setSelectedDuration(preferences.duration);
      setExpiresAt(preferences.expiresAt);
      setDiscoveryReady(true);
      setBlockedIds(blocked.map((profile) => profile.profileId));
      setMeetingPreferences(aboutYou.meeting);
    }).catch(() => {
      if (active) {
        setDiscoveryOn(false);
        setExpiresAt(null);
        setDiscoveryReady(true);
        setRadarState("error");
      }
    });
    return () => { active = false; };
  }, [userId]));

  const applyDiscovery = useCallback((preferences: DiscoveryPreferences) => {
    setDiscoveryOn(preferences.enabled);
    setSelectedDuration(preferences.duration);
    setExpiresAt(preferences.expiresAt);
    if (!preferences.enabled) {
      setProfiles([]);
      setRadarState("idle");
    }
  }, []);
  useDiscoveryExpiry(userId, expiresAt, applyDiscovery);

  const getForegroundFix = async (): Promise<DiscoveryLocation> => {
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { latitude: position.coords.latitude, longitude: position.coords.longitude };
  };

  const scanNearby = () => {
    if (!discoveryOn) {
      Alert.alert("Turn on nearby discovery first", "You control when discovery is active. Turn it on and choose a duration before searching for opted-in people.", [{ text: "OK" }]);
      return;
    }
    Alert.alert("Why Crossa needs location", "Crossa uses foreground location only while you scan and discovery is active. The server compares locations but returns only approximate distance ranges—never exact coordinates.", [
      { text: "Cancel", style: "cancel" },
      { text: "Continue", onPress: () => { void runNearbyScan(); } },
    ]);
  };

  const runNearbyScan = async () => {
    setRadarState("scanning");
    try {
      const permission = await requestLocationPermission();
      if (permission !== "granted") { setRadarState("permission"); return; }
      const location = await getForegroundFix();
      const found = await loadNearbyProfiles(location);
      setProfiles(found);
      setRadarState(found.length ? "idle" : "empty");
    } catch {
      setProfiles([]);
      setRadarState("error");
    }
  };

  const turnOffDiscovery = async () => {
    setSavingDiscovery(true);
    setDiscoveryOn(false);
    setExpiresAt(null);
    setProfiles([]);
    setShowDurationPicker(false);
    try {
      await saveDiscoveryPreferences(userId, false, selectedDuration);
    } catch {
      Alert.alert("Couldn’t turn off discovery", "Please try again. The server may still show discovery as active until this change is saved.");
      setDiscoveryReady(false);
    } finally { setSavingDiscovery(false); }
  };

  const handleDiscoverySwitch = (nextValue: boolean) => {
    if (!discoveryReady || savingDiscovery) return;
    if (!nextValue) { void turnOffDiscovery(); return; }
    setDraftDuration(selectedDuration);
    setShowDurationPicker(true);
  };

  const confirmDiscoveryDuration = async () => {
    if (savingDiscovery) return;
    setSavingDiscovery(true);
    try {
      const permission = await requestLocationPermission();
      if (permission !== "granted") {
        setShowDurationPicker(false);
        Alert.alert("Location permission needed", "Allow foreground location to turn on nearby discovery. Your exact location is never displayed.");
        return;
      }
      const location = await getForegroundFix();
      const preferences = await saveDiscoveryPreferences(userId, true, draftDuration, location);
      setSelectedDuration(preferences.duration);
      setDiscoveryOn(preferences.enabled);
      setExpiresAt(preferences.expiresAt);
      setShowDurationPicker(false);
    } catch {
      Alert.alert("Couldn’t turn on discovery", "Your setting and location were not saved. Please try again.");
    } finally { setSavingDiscovery(false); }
  };

  const eligibleProfiles = useMemo(() => filterProfilesByAudience(
    getDiscoverableProfiles(profiles).filter((profile) => !blockedIds.includes(profile.id)),
    meetingPreferences,
  ), [blockedIds, meetingPreferences, profiles]);
  const filteredProfiles = discoveryOn ? eligibleProfiles : [];

  const openProfile = (profile: NearbyProfile) => navigation.navigate("ProfileDetail", { profile });

  return (
    <View style={styles.screen}>
      <View style={styles.topbar}>
        <View><Text style={styles.h1}>Discover</Text><Text style={styles.sub}>Meet people who choose to be seen</Text></View>
        <View style={styles.topActions}>
          <Pressable style={styles.iconBtn} onPress={() => navigation.navigate("QrDiscovery", { startInScan: true })} accessibilityRole="button" accessibilityLabel="Scan QR code"><Ionicons name="scan-outline" size={20} color={colors.text} /></Pressable>
          <Pressable style={styles.iconBtn} onPress={() => navigation.navigate("Settings")} accessibilityRole="button" accessibilityLabel="Settings"><Ionicons name="settings-outline" size={19} color={colors.text} /></Pressable>
        </View>
      </View>

      <FlatList
        data={filteredProfiles}
        keyExtractor={(profile) => profile.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={<>
          <View style={[styles.statusCard, discoveryOn ? styles.statusOn : styles.statusOff]}>
            <View style={styles.statusRow}>
              <View style={[styles.statusIcon, discoveryOn ? styles.statusIconOn : styles.statusIconOff]}><Ionicons name={discoveryOn ? "eye-outline" : "eye-off-outline"} size={19} color={discoveryOn ? colors.success : colors.accent} /></View>
              <View style={styles.statusTextWrap}><Text style={styles.statusTitle}>Nearby Discovery</Text><Text style={styles.statusCopy}>{discoveryOn ? "Nearby discovery is on" : "Nearby discovery is off"}</Text>{discoveryOn ? <Text style={styles.statusDuration}>Visible for {selectedDuration}</Text> : null}</View>
              <Pressable onPress={() => handleDiscoverySwitch(!discoveryOn)} disabled={!discoveryReady || savingDiscovery} accessibilityRole="switch" accessibilityLabel="Nearby Discovery" accessibilityState={{ checked: discoveryOn, disabled: !discoveryReady || savingDiscovery }} style={[styles.switchTouchTarget, (!discoveryReady || savingDiscovery) && styles.disabledSwitch]}>
                <View style={[styles.switchTrack, discoveryOn ? styles.switchTrackOn : styles.switchTrackOff]}><View style={[styles.switchThumb, discoveryOn ? styles.switchThumbOn : styles.switchThumbOff]} /></View>
              </Pressable>
            </View>
          </View>

          <Modal transparent visible={showDurationPicker} animationType="fade" onRequestClose={() => { if (!savingDiscovery) setShowDurationPicker(false); }}>
            <View style={styles.modalBackdrop}><View style={styles.durationModal}>
              <Text style={styles.modalTitle}>Turn on nearby discovery</Text><Text style={styles.modalCopy}>Choose how long you want to be visible. Discovery will turn off automatically.</Text>
              <View style={styles.durationRow}>{durations.map((duration) => {
                const selected = duration === draftDuration;
                return <Pressable key={duration} onPress={() => setDraftDuration(duration)} disabled={savingDiscovery} accessibilityRole="radio" accessibilityState={{ selected }} style={[styles.durationChip, selected && styles.durationChipSelected]}><Text style={[styles.durationText, selected && styles.durationTextSelected]}>{duration}</Text></Pressable>;
              })}</View>
              <View style={styles.editorActions}><Pressable onPress={() => setShowDurationPicker(false)} disabled={savingDiscovery} accessibilityRole="button" style={[styles.editorBtn, styles.editorCancel]}><Text style={styles.editorCancelText}>Cancel</Text></Pressable><Pressable onPress={() => void confirmDiscoveryDuration()} disabled={savingDiscovery} accessibilityRole="button" style={[styles.editorBtn, styles.editorSave, savingDiscovery && { opacity: 0.6 }]}><Text style={styles.editorSaveText}>{savingDiscovery ? "Turning on…" : "Confirm"}</Text></Pressable></View>
            </View></View>
          </Modal>

          <View style={styles.radarCard}>
            <View style={styles.radarGlyph}><Ionicons name="radio-outline" size={25} color={colors.accent} /></View><Text style={styles.setupTitle}>Nearby radar</Text><Text style={styles.setupCopy}>Find people nearby who have chosen to be discoverable. Results show an approximate range only.</Text>
            <Button label={radarState === "scanning" ? "Scanning…" : "Scan nearby"} variant="default" loading={radarState === "scanning"} disabled={!discoveryOn || radarState === "scanning"} onPress={scanNearby} />
            {!discoveryOn ? <Text style={styles.radarState}>Turn on nearby discovery and choose a duration before scanning.</Text> : null}
            {radarState === "permission" ? <Text style={styles.radarState}>Location permission is off. Allow foreground location in device Settings to scan.</Text> : null}
            {radarState === "empty" ? <Text style={styles.radarState}>No opted-in people were found nearby. Try again later or use QR discovery.</Text> : null}
            {radarState === "error" ? <Text style={styles.radarError}>The scan could not finish. Check your connection and location services, then try again.</Text> : null}
          </View>

          <View style={styles.setupCard}><View style={styles.setupTitleRow}><Ionicons name="shield-checkmark-outline" size={17} color={colors.success} /><Text style={styles.setupTitle}>Your exact location is never displayed</Text></View><Text style={styles.setupCopy}>People see an approximate distance range only. Choose a time period when turning discovery on, and switch it off whenever you want.</Text></View>
          <View style={styles.resultsHeading}><Text style={styles.sectionTitle}>People nearby</Text><Text style={styles.resultCount}>{filteredProfiles.length}</Text></View>
          {meetingPreferences.length > 0 ? <Text style={styles.privateFilterNote}>Personalized with your private Discover preferences</Text> : null}
        </>}
        renderItem={({ item }) => <ProfileCard profile={item} onPress={() => openProfile(item)} />}
        ListEmptyComponent={<EmptyDiscovery discoveryOn={discoveryOn} filteredByAudience={meetingPreferences.length > 0 && !meetingPreferences.includes("Everyone")} onScan={() => navigation.navigate("QrDiscovery", { startInScan: true })} onEditPreferences={() => navigation.navigate("AboutYouSettings")} />}
      />
    </View>
  );
}

function ProfileCard({ profile, onPress }: { profile: NearbyProfile; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return <View style={styles.profileCard}>
    {profile.photoUrl ? <Image source={{ uri: profile.photoUrl }} style={styles.photo} accessibilityLabel={`${profile.displayName}'s profile photo`} /> : <View style={[styles.photo, styles.photoPlaceholder]}><Ionicons name="person" size={19} color={colors.muted} /></View>}
    <View style={styles.profileInfo}><Text style={styles.profileName} numberOfLines={1}>{profile.displayName}</Text><Text style={styles.distance}><Ionicons name="radio-outline" size={12} color={colors.muted} />  {profile.distanceRange}</Text></View>
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.viewButton}><Text style={styles.viewButtonText}>View profile</Text></Pressable>
  </View>;
}

function EmptyDiscovery({ discoveryOn, filteredByAudience, onScan, onEditPreferences }: { discoveryOn: boolean; filteredByAudience: boolean; onScan: () => void; onEditPreferences: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const title = filteredByAudience ? "No one matches your choices yet" : discoveryOn ? "No opted-in people nearby yet" : "No profiles to show yet";
  const description = filteredByAudience ? "Your Discover choices are private. You can update them in Settings or choose Everyone." : discoveryOn ? "Only people who turn on nearby discovery appear here. Try again later or use QR discovery." : "Turn on nearby discovery to see people who have also opted in. You can also find someone in person with a QR code.";
  return <View style={styles.emptyCard}><View style={styles.emptyIcon}><Ionicons name="people-outline" size={27} color={colors.accent} /></View><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyCopy}>{description}</Text>
    {filteredByAudience ? <Pressable onPress={onEditPreferences} accessibilityRole="button" style={styles.scanButton}><Ionicons name="options-outline" size={17} color={colors.accent} /><Text style={styles.scanButtonText}>Change Discover choices</Text></Pressable> : null}
    <Pressable onPress={onScan} accessibilityRole="button" style={styles.scanButton}><Ionicons name="scan-outline" size={17} color={colors.accent} /><Text style={styles.scanButtonText}>Scan a QR code</Text></Pressable>
  </View>;
}

const makeStyles = (colors: Palette) => StyleSheet.create({

  screen: { flex: 1, backgroundColor: colors.background },
  topbar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  h1: { fontSize: 20, fontWeight: "800", color: colors.text },
  sub: { fontSize: 12, color: colors.muted, marginTop: 3 },
  topActions: { flexDirection: "row", gap: 8 },
  iconBtn: { width: 38, height: 38, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16, paddingBottom: 30 },
  statusCard: { padding: 13, borderRadius: radii.lg, borderWidth: 1, marginBottom: 12 },
  statusOn: { backgroundColor: colors.successSoft, borderColor: colors.successSoftBorder },
  statusOff: { backgroundColor: colors.surface, borderColor: colors.border },
  statusIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  statusIconOn: { backgroundColor: colors.successIcon },
  statusIconOff: { backgroundColor: colors.accentSoft },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  statusTextWrap: { flex: 1, minWidth: 0 },
  switchTouchTarget: { minWidth: 50, minHeight: 44, alignItems: "center", justifyContent: "center" },
  disabledSwitch: { opacity: 0.55 },
  switchTrack: { width: 48, height: 28, borderRadius: radii.pill, justifyContent: "center", paddingHorizontal: 3, borderWidth: 1 },
  switchTrackOff: { backgroundColor: colors.borderSoft, borderColor: colors.border },
  switchTrackOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  switchThumb: { width: 20, height: 20, borderRadius: radii.pill, backgroundColor: "#FFFFFF", elevation: 2 },
  switchThumbOff: { alignSelf: "flex-start" },
  switchThumbOn: { alignSelf: "flex-end" },
  editorActions: { flexDirection: "row", gap: 8 },
  editorBtn: { flex: 1, minHeight: 40, borderRadius: radii.md, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  editorCancel: { backgroundColor: colors.surface, borderColor: colors.border },
  editorCancelText: { color: colors.text, fontSize: 13, fontWeight: "700" },
  editorSave: { backgroundColor: colors.accent, borderColor: colors.accent },
  editorSaveText: { color: colors.accentInk, fontSize: 13, fontWeight: "800" },
  statusTitle: { color: colors.text, fontSize: 13, fontWeight: "800" },
  statusCopy: { color: colors.muted, fontSize: 11.5, marginTop: 3, lineHeight: 16 },
  statusDuration: { color: colors.muted, fontSize: 10.5, marginTop: 2, lineHeight: 14 },
  modalBackdrop: { flex: 1, padding: 20, backgroundColor: "rgba(0,0,0,0.48)", alignItems: "center", justifyContent: "center" },
  durationModal: { width: "100%", maxWidth: 420, padding: 18, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  modalTitle: { color: colors.text, fontSize: 17, fontWeight: "800" },
  modalCopy: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 6, marginBottom: 16 },
  actionText: { color: colors.accent, fontSize: 12, fontWeight: "800" },
  radarCard: { padding: 14, backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, marginBottom: 14, alignItems: "flex-start" },
  radarGlyph: { width: 44, height: 44, borderRadius: 15, backgroundColor: colors.borderSoft, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  radarState: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 9 },
  radarError: { color: colors.danger, fontSize: 11, lineHeight: 16, marginTop: 9 },
  setupCard: { padding: 14, backgroundColor: colors.surfaceAlt, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, marginBottom: 18 },
  setupTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  setupTitle: { color: colors.text, fontSize: 12.5, fontWeight: "800", flex: 1 },
  setupCopy: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 7, marginBottom: 13 },
  durationLabel: { fontSize: 12, fontWeight: "800", color: colors.text },
  durationRow: { flexDirection: "row", gap: 7, marginBottom: 12 },
  durationChip: { flex: 1, minHeight: 38, paddingHorizontal: 5, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  durationChipSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  durationText: { color: colors.muted, fontSize: 10.5, fontWeight: "700", textAlign: "center" },
  durationTextSelected: { color: colors.accent },
  skipNote: { color: colors.muted, textAlign: "center", fontSize: 10.5, lineHeight: 15, marginTop: 8 },
  sectionHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 1, marginBottom: 9 },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: colors.text },
  sectionHint: { fontSize: 11, color: colors.muted },
  resultsHeading: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 9 },
  privateFilterNote: { color: colors.muted, fontSize: 10.5, marginTop: -5, marginBottom: 10 },
  resultCount: { minWidth: 21, textAlign: "center", paddingHorizontal: 5, paddingVertical: 2, borderRadius: 99, overflow: "hidden", backgroundColor: colors.borderSoft, color: colors.muted, fontSize: 10, fontWeight: "800" },
  profileCard: { flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: 12, marginBottom: 10 },
  photo: { width: 54, height: 54, borderRadius: 18, backgroundColor: colors.borderSoft },
  photoPlaceholder: { alignItems: "center", justifyContent: "center" },
  profileInfo: { flex: 1, minWidth: 0 },
  profileName: { fontSize: 14, fontWeight: "800", color: colors.text },
  distance: { color: colors.muted, fontSize: 11.5, marginTop: 4 },
  viewButton: { paddingHorizontal: 10, paddingVertical: 9, backgroundColor: colors.accentSoft, borderRadius: 10 },
  viewButtonText: { color: colors.accent, fontSize: 10.5, fontWeight: "800" },
  emptyCard: { alignItems: "center", paddingHorizontal: 20, paddingTop: 24, paddingBottom: 19, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  emptyIcon: { width: 56, height: 56, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.accentSoft, marginBottom: 12 },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: "800", textAlign: "center" },
  emptyCopy: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 7 },
  scanButton: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 14, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 11, backgroundColor: colors.accentSoft },
  scanButtonText: { color: colors.accent, fontSize: 12, fontWeight: "800" },
});
