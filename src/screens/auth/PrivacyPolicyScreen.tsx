import React from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { type Palette } from "@/theme/colors";
import { useThemedStyles } from "@/context/AppearanceContext";

export function PrivacyPolicyScreen() {
  const styles = useThemedStyles(makeStyles);
  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text style={styles.body}>
        This is placeholder policy text for the Crossa prototype. In a shipped app, this screen
        would explain what data Crossa collects, how nearby discovery and location data are
        handled, how message and profile data are stored, and how users can request deletion of
        their account and data.
      </Text>
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  wrap: { padding: 20, backgroundColor: colors.background },
  body: { fontSize: 13, color: colors.muted, lineHeight: 21 },
});
