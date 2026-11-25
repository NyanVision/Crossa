import React, { createContext, useContext, useEffect, useState } from "react";
import { Alert, AppState, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/context/AuthContext";
import { useTheme, useThemedStyles } from "@/context/AppearanceContext";
import { Button } from "@/components/Button";
import { isModerator, reportCategories, submitProfileReport, type ReportCategory } from "@/services/moderation";
import { serviceMessage } from "@/services/messageState";
import type { Palette } from "@/theme/colors";

const Context = createContext<{ report: (id: string, name: string) => void; canModerate: boolean } | null>(null);
export function ReportProvider({ children }: { children: React.ReactNode }) {
  const { userId } = useAuth();
  const { colors, isDark } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [details, setDetails] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [canModerate, setCanModerate] = useState(false);
  useEffect(() => {
    let active = true;
    const check = () => { void isModerator().then((allowed) => { if (active) setCanModerate(allowed); }).catch(() => { if (active) setCanModerate(false); }); };
    check();
    const listener = AppState.addEventListener("change", (state) => { if (state === "active") check(); });
    return () => { active = false; listener.remove(); };
  }, [userId]);
  const report = (id: string, name: string) => {
    setCategory(null); setDetails(""); setError(null); setTarget({ id, name });
  };
  const close = () => { if (!busy) setTarget(null); };
  const submit = async () => {
    if (!target || !category || busy) return;
    setBusy(true); setError(null);
    try {
      await submitProfileReport(target.id, category, details);
      setTarget(null);
      Alert.alert("Report submitted", "Your report is in the review queue. You can also block this person to stop contact.");
    } catch (cause) { setError(serviceMessage(cause, "Couldn’t submit your report. Check your connection and try again.")); }
    finally { setBusy(false); }
  };
  return <Context.Provider value={{ report, canModerate }}>
    {children}
    <Modal visible={target !== null} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.heading}><Text accessibilityRole="header" style={styles.title}>Report {target?.name}</Text><Pressable onPress={close} disabled={busy} accessibilityRole="button" accessibilityLabel="Close report" style={styles.close}><Ionicons name="close" size={24} color={colors.text} /></Pressable></View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <Text style={styles.copy}>Choose the reason that best describes the problem. Your report is shared with Crossa’s review team.</Text>
            {reportCategories.map((option) => <Pressable key={option.value} disabled={busy} onPress={() => setCategory(option.value)} accessibilityRole="radio" accessibilityState={{ checked: category === option.value }} style={[styles.option, category === option.value && styles.selected]}>
              <Ionicons name={category === option.value ? "radio-button-on" : "radio-button-off"} color={category === option.value ? colors.accent : colors.muted} size={21} /><Text style={styles.optionLabel}>{option.label}</Text>
            </Pressable>)}
            <Text style={styles.label}>Details (optional)</Text>
            <TextInput value={details} onChangeText={setDetails} maxLength={1000} multiline editable={!busy} keyboardAppearance={isDark ? "dark" : "light"} placeholder="Tell us what happened" placeholderTextColor={colors.muted} style={styles.input} accessibilityLabel="Report details" />
            <Text style={styles.copy}>{details.length}/1000</Text>
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            <Button label="Submit report" variant="primary" loading={busy} disabled={!category || busy} onPress={submit} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  </Context.Provider>;
}
export function useReporting() {
  const value = useContext(Context);
  if (!value) throw new Error("useReporting must be inside ReportProvider");
  return value;
}
const makeStyles = (colors: Palette) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 16 },
  sheet: { backgroundColor: colors.surface, borderRadius: 20, maxHeight: "90%", width: "100%", maxWidth: 500, alignSelf: "center" },
  heading: { flexDirection: "row", alignItems: "center", padding: 16, borderBottomColor: colors.border, borderBottomWidth: 1 },
  title: { color: colors.text, fontSize: 19, fontWeight: "800", flex: 1 },
  close: { padding: 10 }, content: { padding: 16, gap: 10 },
  copy: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  option: { flexDirection: "row", alignItems: "center", gap: 10, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 12, minHeight: 48 },
  selected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  optionLabel: { color: colors.text, fontSize: 14, lineHeight: 20, flex: 1 },
  label: { color: colors.text, fontSize: 14, fontWeight: "700", marginTop: 10 },
  input: { color: colors.text, backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 90, textAlignVertical: "top" },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19 },
});
