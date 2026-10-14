import React, { useEffect, useState } from "react";
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "@/components/Button";
import { acceptInboxRequest, declineInboxRequest, loadInbox, markInboxConversationRead, removeInboxConversation } from "@/services/inbox";
import { recordProfileReport, setProfileBlocked } from "@/services/profileSafety";
import type { InboxConversation } from "@/types";
import { type Palette, radii } from "@/theme/colors";
import { useTheme, useThemedStyles } from "@/context/AppearanceContext";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "@/navigation/AppTabs";

type Props = NativeStackScreenProps<AppStackParamList, "MessageRequestDetail">;

export function MessageRequestScreen({ route, navigation }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const [request, setRequest] = useState<InboxConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let active = true;
    loadInbox().then(async (items) => {
      const found = items.find((item) => item.id === route.params.requestId && item.status === "request") ?? null;
      if (!active) return;
      setRequest(found);
      if (found) await markInboxConversationRead(found.id);
    }).catch(() => { if (active) setRequest(null); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [route.params.requestId]);

  const firstMessage = request?.firstMessage?.trim() || request?.messages[0]?.text || request?.lastMessage?.trim() || "";

  const accept = async () => {
    if (!request) return;
    setWorking(true);
    try {
      const accepted = await acceptInboxRequest(request.id);
      if (!accepted) {
        Alert.alert("Request unavailable", "This request may already have been handled.");
        navigation.goBack();
        return;
      }
      navigation.replace("Chat", { chatId: request.id });
    } catch {
      Alert.alert("Couldn’t accept request", "Please try again.");
    } finally {
      setWorking(false);
    }
  };

  const decline = () => {
    if (!request) return;
    Alert.alert("Decline this request?", `This will remove the message request from ${request.displayName}.`, [
      { text: "Keep request", style: "cancel" },
      { text: "Decline", style: "destructive", onPress: async () => {
        setWorking(true);
        try {
          await declineInboxRequest(request.id);
          navigation.goBack();
        } catch { Alert.alert("Couldn’t decline request", "Please try again."); }
        finally { setWorking(false); }
      } },
    ]);
  };

  const block = () => {
    if (!request) return;
    Alert.alert("Block this person?", `${request.displayName} will be blocked and their requests and chats will no longer be available.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Block", style: "destructive", onPress: async () => {
        setWorking(true);
        try {
          await setProfileBlocked(request.profileId, true, request.displayName);
          await removeInboxConversation(request.id);
          navigation.goBack();
        } catch { Alert.alert("Couldn’t block profile", "Please try again."); }
        finally { setWorking(false); }
      } },
    ]);
  };

  const report = () => {
    if (!request) return;
    Alert.alert("Report this person?", `Report ${request.displayName} for review?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Report", style: "destructive", onPress: async () => {
        try {
          await recordProfileReport(request.profileId);
          Alert.alert("Report saved", "Your report has been submitted for review.");
        } catch { Alert.alert("Report not saved", "Please try again."); }
      } },
    ]);
  };

  if (!request) {
    return <View style={styles.unavailable}>
      <Pressable onPress={() => navigation.goBack()} style={styles.backButton} accessibilityLabel="Back"><Ionicons name="arrow-back" size={20} color={colors.text} /></Pressable>
      <View style={styles.unavailableContent}><Ionicons name="mail-open-outline" size={30} color={colors.muted} /><Text style={styles.unavailableTitle}>{loading ? "Loading request…" : "Request unavailable"}</Text><Text style={styles.unavailableCopy}>This request may have been accepted, declined, or removed.</Text></View>
    </View>;
  }

  return <View style={styles.screen}>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}><Pressable onPress={() => navigation.goBack()} style={styles.backButton} accessibilityLabel="Back"><Ionicons name="arrow-back" size={20} color={colors.text} /></Pressable><Text style={styles.headerTitle}>Message request</Text><View style={{ width: 40 }} /></View>

      <View style={styles.senderCard}>
        {request.photoUri ? <Image source={{ uri: request.photoUri }} style={styles.photo} accessibilityLabel={`${request.displayName}'s profile photo`} /> : <View style={styles.photoPlaceholder}><Ionicons name="person" size={33} color={colors.muted} /></View>}
        <Text style={styles.senderName}>{request.displayName}</Text>
        {request.profilePreview?.distanceRange ? <View style={styles.distancePill}><Ionicons name="radio-outline" size={13} color={colors.muted} /><Text style={styles.distance}>{request.profilePreview.distanceRange}</Text></View> : null}
      </View>

      <View style={styles.previewCard}>
        <View style={styles.cardHeading}><Ionicons name="person-circle-outline" size={18} color={colors.accent} /><Text style={styles.cardTitle}>Profile preview</Text></View>
        <Text style={styles.bio}>{request.profilePreview?.bio?.trim() || "No bio shared"}</Text>
        {request.profilePreview?.interests?.length ? <View style={styles.interests}>{request.profilePreview.interests.map((interest) => <View key={interest} style={styles.interestChip}><Text style={styles.interestText}>{interest}</Text></View>)}</View> : null}
        <Text style={styles.previewNote}>Contact links stay private until you choose to view their profile.</Text>
      </View>

      <View style={styles.messageCard}>
        <View style={styles.cardHeading}><Ionicons name="chatbubble-ellipses-outline" size={17} color={colors.accent} /><Text style={styles.cardTitle}>First message</Text></View>
        <Text style={styles.messageText}>{firstMessage || "No message was included with this request."}</Text>
      </View>

      <View style={styles.privacyNote}><Ionicons name="lock-closed-outline" size={17} color={colors.success} /><Text style={styles.privacyText}>Accepting opens a private chat. The sender can’t send further messages until you accept.</Text></View>

      <View style={styles.safetyRow}>
        <Pressable onPress={block} disabled={working} style={styles.safetyAction} accessibilityRole="button"><Ionicons name="ban-outline" size={17} color={colors.danger} /><Text style={[styles.safetyLabel, styles.danger]}>Block</Text></Pressable>
        <View style={styles.divider} />
        <Pressable onPress={report} disabled={working} style={styles.safetyAction} accessibilityRole="button"><Ionicons name="flag-outline" size={17} color={colors.muted} /><Text style={styles.safetyLabel}>Report</Text></Pressable>
      </View>
    </ScrollView>

    <View style={styles.footer}>
      <Button label="Decline" onPress={decline} disabled={working} style={styles.footerButton} />
      <Button label="Accept" variant="primary" onPress={accept} loading={working} disabled={working} style={styles.footerButton} />
    </View>
  </View>;
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingBottom: 20 },
  header: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backButton: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  headerTitle: { color: colors.text, fontSize: 16, fontWeight: "800" },
  senderCard: { alignItems: "center", paddingTop: 12, paddingBottom: 21 },
  photo: { width: 92, height: 92, borderRadius: 31, backgroundColor: colors.borderSoft, marginBottom: 11 },
  photoPlaceholder: { width: 92, height: 92, borderRadius: 31, backgroundColor: colors.borderSoft, alignItems: "center", justifyContent: "center", marginBottom: 11 },
  senderName: { color: colors.text, fontSize: 20, fontWeight: "800" },
  distancePill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.pill, backgroundColor: colors.borderSoft, marginTop: 7 },
  distance: { color: colors.muted, fontSize: 11.5, fontWeight: "600" },
  previewCard: { padding: 14, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.surface, marginBottom: 11 },
  cardHeading: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 8 },
  cardTitle: { color: colors.text, fontSize: 12.5, fontWeight: "800" },
  bio: { color: colors.muted, fontSize: 12.5, lineHeight: 18 },
  interests: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  interestChip: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: radii.pill, backgroundColor: colors.borderSoft },
  interestText: { color: colors.muted, fontSize: 10.5, fontWeight: "700" },
  previewNote: { color: colors.muted, fontSize: 10.5, lineHeight: 15, marginTop: 10 },
  messageCard: { padding: 14, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.surface, marginBottom: 12 },
  messageText: { color: colors.text, fontSize: 14, lineHeight: 21 },
  privacyNote: { flexDirection: "row", alignItems: "flex-start", gap: 9, padding: 12, borderRadius: radii.md, backgroundColor: colors.successSoft, borderWidth: 1, borderColor: colors.successSoftBorder },
  privacyText: { flex: 1, color: colors.text, fontSize: 11.5, lineHeight: 17 },
  safetyRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 22, marginVertical: 14 },
  safetyAction: { flexDirection: "row", alignItems: "center", gap: 7, padding: 7 },
  safetyLabel: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  danger: { color: colors.danger },
  divider: { width: 1, height: 18, backgroundColor: colors.border },
  footer: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.borderSoft, backgroundColor: colors.background },
  footerButton: { flex: 1 },
  unavailable: { flex: 1, backgroundColor: colors.background, padding: 18 },
  unavailableContent: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  unavailableTitle: { color: colors.text, fontSize: 15, fontWeight: "800", marginTop: 12 },
  unavailableCopy: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 5, textAlign: "center" },
});
