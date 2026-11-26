import React from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { type Palette } from "@/theme/colors";
import { useThemedStyles } from "@/context/AppearanceContext";
import { privacyPolicySections, privacyPolicyUpdated } from "@/content/privacyPolicy";

const contactEmail = process.env.EXPO_PUBLIC_PRIVACY_CONTACT_EMAIL?.trim() ?? "";
const policyUrl = process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL?.trim() ?? "";

export function PrivacyPolicyScreen() {
  const styles = useThemedStyles(makeStyles);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.wrap}>
      <Text style={styles.title} accessibilityRole="header">Crossa Privacy Policy</Text>
      <Text style={styles.updated}>Updated {privacyPolicyUpdated}</Text>
      {privacyPolicySections(contactEmail).map((section) => <View key={section.title} style={styles.section}>
        <Text style={styles.heading} accessibilityRole="header">{section.title}</Text>
        {section.paragraphs.map((paragraph) => <Text key={paragraph} selectable style={styles.body}>{paragraph}</Text>)}
      </View>)}
      {/^https:\/\//.test(policyUrl) ? <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(policyUrl).catch(() => undefined); }} style={styles.linkButton}><Text style={styles.link}>Open published policy</Text></Pressable> : null}
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  wrap: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 23, color: colors.text, fontWeight: "800" },
  updated: { fontSize: 12, color: colors.muted, marginTop: 8 },
  section: { marginTop: 24, gap: 10 },
  heading: { fontSize: 17, color: colors.text, fontWeight: "700" },
  body: { fontSize: 14, color: colors.text, lineHeight: 22 },
  linkButton: { minHeight: 48, justifyContent: "center", marginTop: 18 },
  link: { fontSize: 14, color: colors.accent, fontWeight: "700" },
});
