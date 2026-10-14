import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "@/components/Button";
import { type Palette, radii } from "@/theme/colors";
import { useTheme, useThemedStyles } from "@/context/AppearanceContext";
import { emptyAboutYouPreferences, type AboutYouPreferences, type GenderOption, type MeetingOption } from "@/services/aboutYouPreferences";

const genders: GenderOption[] = ["Woman", "Man", "Non-binary", "Self-describe", "Prefer not to say"];
const meetingOptions: MeetingOption[] = ["Women", "Men", "Non-binary people", "Everyone"];

interface Props {
  initialValue: AboutYouPreferences;
  submitLabel: string;
  saving?: boolean;
  onSave: (value: AboutYouPreferences) => void;
  onCancel?: () => void;
}

export function AboutYouForm({ initialValue, submitLabel, saving = false, onSave, onCancel }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors, isDark } = useTheme();
  const [gender, setGender] = useState<GenderOption | null>(initialValue.gender);
  const [genderDescription, setGenderDescription] = useState(initialValue.genderDescription);
  const [showGenderOnProfile, setShowGenderOnProfile] = useState(initialValue.showGenderOnProfile);
  const [meeting, setMeeting] = useState<MeetingOption[]>(initialValue.meeting);

  useEffect(() => {
    setGender(initialValue.gender);
    setGenderDescription(initialValue.genderDescription);
    setShowGenderOnProfile(initialValue.showGenderOnProfile);
    setMeeting(initialValue.meeting);
  }, [initialValue]);

  const chooseGender = (value: GenderOption) => {
    setGender(value);
    if (value === "Prefer not to say") setShowGenderOnProfile(false);
  };

  const toggleMeeting = (value: MeetingOption) => {
    if (value === "Everyone") {
      setMeeting((current) => current.includes("Everyone") ? [] : ["Everyone"]);
      return;
    }
    setMeeting((current) => current.includes(value)
      ? current.filter((option) => option !== value && option !== "Everyone")
      : [...current.filter((option) => option !== "Everyone"), value]);
  };

  const visibleGenderCanBeShown = gender !== null
    && gender !== "Prefer not to say"
    && (gender !== "Self-describe" || genderDescription.trim().length > 0);

  const skipGender = () => {
    setGender(null);
    setGenderDescription("");
    setShowGenderOnProfile(false);
  };

  const skipMeeting = () => setMeeting([]);

  const save = () => onSave({
    ...emptyAboutYouPreferences(),
    gender,
    genderDescription: gender === "Self-describe" ? genderDescription.trim() : "",
    showGenderOnProfile: showGenderOnProfile && visibleGenderCanBeShown,
    meeting,
  });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.intro}><Text style={styles.title}>A little about you</Text><Text style={styles.introText}>These questions are optional. You can skip either one and change your answers later.</Text></View>

      <View style={styles.questionCard}>
        <View style={styles.questionTitleRow}><View style={styles.numberBadge}><Text style={styles.numberText}>1</Text></View><Text style={styles.questionTitle}>What’s your gender?</Text></View>
        <Text style={styles.questionHint}>Your answer is private unless you choose to show it on your profile.</Text>
        <View style={styles.optionsList}>{genders.map((option) => {
          const selected = gender === option;
          return <Pressable key={option} onPress={() => chooseGender(option)} accessibilityRole="radio" accessibilityState={{ checked: selected }} style={[styles.optionRow, selected && styles.optionSelected]}>
            <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>{selected ? <View style={styles.radioInner} /> : null}</View>
            <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option}</Text>
            {option === "Prefer not to say" ? <Text style={styles.optionalLabel}>optional</Text> : null}
          </Pressable>;
        })}</View>
        {gender === "Self-describe" ? <View style={styles.descriptionField}><Text style={styles.fieldLabel}>How would you describe your gender? (optional)</Text><TextInput keyboardAppearance={isDark ? "dark" : "light"} value={genderDescription} onChangeText={setGenderDescription} placeholder="Your words" placeholderTextColor={colors.muted} maxLength={48} style={styles.input} accessibilityLabel="Describe your gender" /></View> : null}
        <View style={styles.visibilityRow}>
          <View style={styles.visibilityCopy}><Text style={styles.visibilityTitle}>Show this on my profile</Text><Text style={styles.visibilityHint}>{visibleGenderCanBeShown ? "Off by default. You control this separately." : gender === "Self-describe" ? "Add a description first to make it visible." : "Choose a gender option to enable this setting."}</Text></View>
          <Switch value={showGenderOnProfile} onValueChange={setShowGenderOnProfile} disabled={!visibleGenderCanBeShown} trackColor={{ false: colors.border, true: colors.accent }} thumbColor={colors.surface} accessibilityLabel="Show gender on my profile" />
        </View>
        <Pressable onPress={skipGender} style={styles.skipButton} accessibilityRole="button"><Text style={styles.skipText}>Skip this question</Text></Pressable>
      </View>

      <View style={styles.questionCard}>
        <View style={styles.questionTitleRow}><View style={styles.numberBadge}><Text style={styles.numberText}>2</Text></View><Text style={styles.questionTitle}>Who are you hoping to meet?</Text></View>
        <Text style={styles.questionHint}>Choose any combination, or choose Everyone. We’ll use this only to filter your Discover results. It won’t appear on your profile.</Text>
        <View style={styles.optionsList}>{meetingOptions.map((option) => {
          const selected = meeting.includes(option);
          return <Pressable key={option} onPress={() => toggleMeeting(option)} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} style={[styles.optionRow, selected && styles.optionSelected]}>
            <View style={[styles.checkbox, selected && styles.checkboxSelected]}>{selected ? <Ionicons name="checkmark" size={14} color={colors.accentInk} /> : null}</View>
            <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option}</Text>
          </Pressable>;
        })}</View>
        <Pressable onPress={skipMeeting} style={styles.skipButton} accessibilityRole="button"><Text style={styles.skipText}>Skip this question</Text></Pressable>
      </View>

      <View style={styles.actions}>
        {onCancel ? <Button label="Cancel" onPress={onCancel} style={styles.actionButton} /> : null}
        <Button label={submitLabel} variant="primary" onPress={save} loading={saving} disabled={saving} style={styles.actionButton} />
      </View>
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 18, paddingBottom: 30 },
  intro: { marginBottom: 13 },
  title: { color: colors.text, fontSize: 21, fontWeight: "800" },
  introText: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 5 },
  questionCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: 14, marginBottom: 12 },
  questionTitleRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  numberBadge: { width: 25, height: 25, borderRadius: 9, backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center" },
  numberText: { color: colors.accent, fontSize: 11, fontWeight: "800" },
  questionTitle: { color: colors.text, fontSize: 14, fontWeight: "800", flex: 1 },
  questionHint: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 7, marginBottom: 10 },
  optionsList: { gap: 6 },
  optionRow: { minHeight: 43, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, borderRadius: radii.md, borderWidth: 1, borderColor: colors.borderSoft, backgroundColor: colors.surface },
  optionSelected: { borderColor: colors.accentSoftBorder, backgroundColor: colors.surfaceAlt },
  radioOuter: { width: 19, height: 19, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  radioOuterSelected: { borderColor: colors.accent },
  radioInner: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.accent },
  optionText: { color: colors.text, fontSize: 12.5, fontWeight: "600", flex: 1 },
  optionTextSelected: { color: colors.accent, fontWeight: "800" },
  optionalLabel: { color: colors.muted, fontSize: 9.5 },
  descriptionField: { marginTop: 11 },
  fieldLabel: { color: colors.muted, fontSize: 10.5, fontWeight: "700", marginBottom: 6 },
  input: { minHeight: 42, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: 11, fontSize: 12.5 },
  visibilityRow: { flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, borderTopColor: colors.borderSoft, marginTop: 12, paddingTop: 11 },
  visibilityCopy: { flex: 1 },
  visibilityTitle: { color: colors.text, fontSize: 11.5, fontWeight: "800" },
  visibilityHint: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 3 },
  skipButton: { alignSelf: "flex-start", paddingVertical: 7, paddingHorizontal: 2, marginTop: 7 },
  skipText: { color: colors.muted, fontSize: 10.5, fontWeight: "700", textDecorationLine: "underline" },
  checkbox: { width: 19, height: 19, borderRadius: 5, borderWidth: 1.5, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  checkboxSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  actions: { flexDirection: "row", gap: 10, marginTop: 2 },
  actionButton: { flex: 1 },
});
