import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "@/components/Button";
import { useReporting } from "@/context/ReportContext";
import { useTheme, useThemedStyles } from "@/context/AppearanceContext";
import { loadReports, reportCategories, reviewReport, type ProfileReport, type ReportStatus } from "@/services/moderation";
import { serviceMessage } from "@/services/messageState";
import type { Palette } from "@/theme/colors";

const statuses: ReportStatus[] = ["open", "reviewing", "resolved", "dismissed"];
export function ModerationScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors, isDark } = useTheme();
  const { canModerate } = useReporting();
  const [status, setStatus] = useState<ReportStatus>("open");
  const [reports, setReports] = useState<ProfileReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ProfileReport | null>(null);
  const [note, setNote] = useState("");
  const [working, setWorking] = useState(false);
  const revision = useRef(0);
  const load = useCallback(async (before?: ProfileReport) => {
    const version = ++revision.current; setLoading(true); setError(null);
    try {
      const page = await loadReports(status, before);
      if (version !== revision.current) return;
      setReports((current) => before ? [...current, ...page.reports] : page.reports); setHasMore(page.hasMore);
    } catch (cause) { if (version === revision.current) setError(serviceMessage(cause, "Couldn’t load reports.")); }
    finally { if (version === revision.current) setLoading(false); }
  }, [status]);
  useEffect(() => { setReports([]); setSelected(null); if (canModerate) void load(); return () => { revision.current++; }; }, [canModerate, load]);
  const review = async (next: Exclude<ReportStatus, "open">) => {
    if (!selected || working) return;
    setWorking(true); setError(null);
    try { await reviewReport(selected.id, next, note); setSelected(null); await load(); }
    catch (cause) { setError(serviceMessage(cause, "Couldn’t save the review.")); }
    finally { setWorking(false); }
  };
  if (!canModerate) return <View style={styles.state}><Text style={styles.title}>Moderator access required</Text><Text style={styles.copy}>This review queue is available only to accounts assigned a moderator role.</Text></View>;
  return <View style={styles.screen}>
    <Text style={styles.title}>Report review</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters} contentContainerStyle={{ gap: 8 }}>
      {statuses.map((value) => <Pressable key={value} onPress={() => setStatus(value)} disabled={working} accessibilityRole="tab" accessibilityState={{ selected: value === status }} style={[styles.filter, value === status && styles.filterActive]}><Text style={styles.filterText}>{value[0].toUpperCase() + value.slice(1)}</Text></Pressable>)}
    </ScrollView>
    {error ? <View style={styles.notice}><Text style={styles.error} accessibilityRole="alert">{error}</Text><Button label="Retry" onPress={() => void load()} /></View> : null}
    {selected ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.detail}>
      <Text style={styles.title}>{selected.reported_name || "Unnamed profile"}</Text>
      <Text style={styles.copy}>Reported by {selected.reporter_name || "Unnamed profile"} · {new Date(selected.created_at).toLocaleString()}</Text>
      <Text style={styles.label}>{reportCategories.find((option) => option.value === selected.category)?.label ?? "Other"}</Text>
      <Text style={styles.body}>{selected.details || "No extra details were provided."}</Text>
      <Text style={styles.label}>Review notes</Text>
      <TextInput accessibilityLabel="Moderator review notes" value={note} onChangeText={setNote} maxLength={1000} multiline editable={!working} keyboardAppearance={isDark ? "dark" : "light"} placeholder="Record the review and any action taken" placeholderTextColor={colors.muted} style={styles.input} />
      <Text style={styles.copy}>These actions update the report’s review status. Account enforcement is managed separately.</Text>
      <Button label="Mark reviewing" onPress={() => void review("reviewing")} disabled={working} />
      <Button label="Resolve report" variant="primary" onPress={() => void review("resolved")} disabled={working} loading={working} />
      <Button label="Dismiss report" onPress={() => void review("dismissed")} disabled={working} />
      <Button label="Back to reports" variant="ghost" onPress={() => setSelected(null)} disabled={working} />
    </ScrollView> : <FlatList data={reports} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} refreshing={loading && reports.length > 0} onRefresh={() => void load()}
      renderItem={({ item }) => <Pressable accessibilityRole="button" onPress={() => { setSelected(item); setNote(item.moderator_note); }} style={styles.card}><Text style={styles.label}>{item.reported_name || "Unnamed profile"}</Text><Text style={styles.body}>{reportCategories.find((option) => option.value === item.category)?.label ?? "Other"}</Text><Text style={styles.copy} numberOfLines={2}>{item.details || "No extra details"}</Text><Text style={styles.copy}>{new Date(item.created_at).toLocaleString()}</Text></Pressable>}
      ListEmptyComponent={loading ? <ActivityIndicator color={colors.accent} /> : error ? null : <Text style={styles.copy}>No {status} reports.</Text>}
      ListFooterComponent={hasMore ? <Button label={loading ? "Loading…" : "Load more"} disabled={loading} onPress={() => void load(reports.at(-1))} /> : null} />}
  </View>;
}
const makeStyles = (colors: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingTop: 16 },
  state: { flex: 1, padding: 24, justifyContent: "center", backgroundColor: colors.background, gap: 10 },
  title: { color: colors.text, fontSize: 21, fontWeight: "800", paddingHorizontal: 16 },
  filters: { flexGrow: 0, maxHeight: 58, marginHorizontal: 16, marginVertical: 12 },
  filter: { minHeight: 44, paddingHorizontal: 14, justifyContent: "center", borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  filterActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  filterText: { color: colors.text, fontWeight: "600" },
  list: { padding: 16, gap: 10 }, card: { padding: 16, borderRadius: 14, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, gap: 6 },
  label: { color: colors.text, fontSize: 15, fontWeight: "700" }, body: { color: colors.text, fontSize: 14, lineHeight: 21 },
  copy: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  detail: { padding: 16, gap: 14 },
  input: { minHeight: 100, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 12, padding: 12, color: colors.text, textAlignVertical: "top" },
  notice: { marginHorizontal: 16, padding: 12, backgroundColor: colors.dangerSoft, borderRadius: 12 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19 },
});
