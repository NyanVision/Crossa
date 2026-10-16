import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { type Palette } from "@/theme/colors";
import { useThemedStyles } from "@/context/AppearanceContext";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AuthStackParamList } from "@/navigation/AuthNavigator";

type Props = NativeStackScreenProps<AuthStackParamList, "Welcome">;

// Intentionally text-only — no people collage or stock photography.
export function WelcomeScreen({ navigation }: Props) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.wrap}>
      <View style={styles.brand}>
        <View style={styles.mark}>
          <Text style={styles.markText}>C</Text>
        </View>
        <Text style={styles.name}>Crossa</Text>
        <Text style={styles.tagline}>Meet people around you, on your terms.</Text>
      </View>

      <View style={styles.actions}>
        <Button label="Get started" variant="primary" onPress={() => navigation.navigate("CreateAccount")} />
        <Button
          label="I already have an account"
          variant="ghost"
          onPress={() => navigation.navigate("SignIn")}
          style={{ marginTop: 10, paddingVertical: 13, alignItems: "center" }}
        />
      </View>
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "space-between",
    padding: 26,
    paddingTop: 90,
    paddingBottom: 40,
  },
  brand: { alignItems: "center" },
  mark: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 22,
  },
  markText: { color: colors.accentInk, fontWeight: "800", fontSize: 28 },
  name: { fontSize: 28, fontWeight: "800", color: colors.text, letterSpacing: -0.3 },
  tagline: {
    fontSize: 15,
    color: colors.muted,
    marginTop: 10,
    textAlign: "center",
    lineHeight: 21,
    maxWidth: 260,
  },
  actions: { width: "100%" },
});
