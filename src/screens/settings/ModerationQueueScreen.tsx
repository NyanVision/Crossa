import React, { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, useThemedStyles } from "@/context/AppearanceContext";
import { type Palette, radii } from "@/theme/colors";
import { loadModerationQueue, loadModeratorRole, resolveModerationReport, type ModerationAction, type ModerationReport, type ModeratorRole } from "@/services/moderation";

export function ModerationQueueScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const [role, setRole] = useState<ModeratorRole | null>(null);
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);
    Promise.all([loadModeratorRole(), loadModerationQueue()])
      .then(([currentRole, queue]) => {
        if (!active) return;
        setRole(currentRole);
        setReports(currentRole ? queue : []);
      })
      .catch(() => { if (active) setLoadError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reloadKey]));

  const act = async (report: ModerationReport, action: ModerationAction) => {
    setBusyId(report.id);
    try {
      const resolved = await resolveModerationReport(report, action);
      if (!resolved) {
        Alert.alert("Report already reviewed", "Reload the queue to see the latest status.");
      } else {
        setReports((current) => current.filter((item) => item.id !== report.id));
      }
    } catch {
      Alert.alert("Couldn’t save moderation action", "The report has not been marked resolved. Check your connection and retry.");
    } finally { setBusyId(null); }
  };

  const chooseAction = (report: ModerationReport, action: ModerationAction) => {
    if (action !== "suspend") { void act(report, action); return; }
    Alert.alert(
      "Suspend this account?",
      "The account will lose discovery and push access and will be signed out. The action and report reason will be recorded for review.",
      [{ text: "Cancel", style: "cancel" }, { text: "Suspend account", style: "destructive", onPress: () => { void act(report, action); } }],
    );
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.accent} /><Text style={styles.muted}>Loading moderation queue…</Text></View>;
  if (loadError) return <View style={styles.center}><Ionicons name="cloud-offline-outline" size={30} color={colors.danger} /><Text style={styles.title}>Couldn’t load reports</Text><Text style={styles.muted}>The queue could not be verified. Check your connection and retry.</Text><Pressable style={styles.retryButton} onPress={() => setReloadKey((value) => value + 1)} accessibilityRole="button"><Text style={styles.retryText}>Retry</Text></Pressable></View>;
  if (!role) return <View style={styles.center}><Ionicons name="lock-closed-outline" size={30} color={colors.muted} /><Text style={styles.title}>No moderator access</Text><Text style={styles.muted}>This area is limited to CatchYa moderators.</Text></View>;

  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    <Text style={styles.heading}>Open reports</Text>
    <Text style={styles.subheading}>Moderator actions are recorded. Choose the least restrictive action that addresses the report.</Text>
    {reports.length === 0 ? <View style={styles.empty}><Ionicons name="checkmark-circle-outline" size={26} color={colors.success} /><Text style={styles.title}>No open reports</Text><Text style={styles.muted}>New reports will appear here.</Text></View> : reports.map((report) => {
      const busy = busyId === report.id;
      return <View key={report.id} style={styles.reportCard}>
        <View style={styles.reportHeader}><Text style={styles.reportTitle}>Reported profile · {report.reported_user.slice(0, 8)}</Text><Text style={styles.date}>{new Date(report.created_at).toLocaleString()}</Text></View>
        <Text style={styles.label}>Reason</Text><Text style={styles.reason}>{report.reason || "No reason supplied"}</Text>
        <Text style={styles.reportId}>Report {report.id.slice(0, 8)} · reporter {report.reporter_id.slice(0, 8)}</Text>
        {busy ? <ActivityIndicator style={styles.actionSpinner} color={colors.accent} /> : <View style={styles.actions}>
          <ActionButton title="Dismiss" onPress={() => chooseAction(report, "dismiss")} styles={styles} disabled={busyId !== null} />
          <ActionButton title="Warn" onPress={() => chooseAction(report, "warn")} styles={styles} disabled={busyId !== null} />
          <ActionButton title="Suspend" onPress={() => chooseAction(report, "suspend")} styles={styles} disabled={busyId !== null} destructive />
        </View>}
      </View>;
    })}
  </ScrollView>;
}

function ActionButton({ title, onPress, styles, disabled, destructive = false }: { title: string; onPress: () => void; styles: ReturnType<typeof makeStyles>; disabled: boolean; destructive?: boolean }) {
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" style={[styles.actionButton, destructive && styles.destructiveButton, disabled && styles.disabled]}><Text style={[styles.actionText, destructive && styles.destructiveText]}>{title}</Text></Pressable>;
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 18, paddingBottom: 30 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 26, backgroundColor: colors.background, gap: 9 },
  heading: { color: colors.text, fontSize: 20, fontWeight: "800" },
  subheading: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 5, marginBottom: 15 },
  title: { color: colors.text, fontSize: 15, fontWeight: "800", marginTop: 5, textAlign: "center" },
  muted: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 4 },
  empty: { alignItems: "center", padding: 24, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  reportCard: { padding: 14, marginBottom: 11, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  reportHeader: { gap: 4 },
  reportTitle: { color: colors.text, fontSize: 13, fontWeight: "800" },
  date: { color: colors.muted, fontSize: 10 },
  label: { color: colors.muted, fontSize: 10, fontWeight: "800", marginTop: 12 },
  reason: { color: colors.text, fontSize: 12, lineHeight: 18, marginTop: 3 },
  reportId: { color: colors.muted, fontSize: 9.5, marginTop: 9 },
  actions: { flexDirection: "row", gap: 7, marginTop: 13 },
  actionButton: { flex: 1, minHeight: 37, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, justifyContent: "center", alignItems: "center", paddingHorizontal: 5 },
  destructiveButton: { backgroundColor: colors.dangerSoft, borderColor: colors.dangerSoft },
  actionText: { color: colors.text, fontSize: 10.5, fontWeight: "800" },
  destructiveText: { color: colors.danger },
  disabled: { opacity: 0.5 },
  actionSpinner: { marginVertical: 12 },
  retryButton: { minHeight: 42, minWidth: 110, paddingHorizontal: 18, borderRadius: radii.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent, marginTop: 10 },
  retryText: { color: colors.accentInk, fontWeight: "800", fontSize: 12 },
});
