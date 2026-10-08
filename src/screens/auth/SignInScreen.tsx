import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/Button";
import { TextField } from "@/components/TextField";
import { Banner } from "@/components/Banner";
import { type Palette } from "@/theme/colors";
import { useTheme, useThemedStyles } from "@/context/AppearanceContext";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AuthStackParamList } from "@/navigation/AuthNavigator";

type Props = NativeStackScreenProps<AuthStackParamList, "SignIn">;

export function SignInScreen({ navigation }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { signInWithGoogle, signInWithEmail, error, loading, clearError } = useAuth();
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
      <View style={styles.brand}>
        <Text style={styles.h1}>Sign in</Text>
        <Text style={styles.sub}>Sign in to your CatchYa account to continue.</Text>
        <Text style={styles.testNotice}>Your account and profile sync securely across your devices.</Text>
      </View>

      <Banner message={error} />

      <Button
        label="Continue with Google"
        variant="default"
        loading={loading}
        onPress={() => {
          clearError();
          signInWithGoogle();
        }}
        icon={<Ionicons name="logo-google" size={18} color="#4285F4" />}
      />

      <View style={{ height: 10 }} />

      <Button
        label="Continue with email"
        onPress={() => setShowEmailForm((v) => !v)}
        icon={<Ionicons name="mail-outline" size={18} color={colors.text} />}
      />

      {showEmailForm && (
        <View style={{ marginTop: 14 }}>
          <TextField label="Email" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="you@example.com" />
          <TextField label="Password" secureTextEntry value={password} onChangeText={setPassword} placeholder="••••••••" />
          <Text style={styles.forgot} onPress={() => navigation.navigate("ResetPassword")}>
            Forgot password?
          </Text>
          <Button
            label="Sign in"
            variant="primary"
            loading={loading}
            onPress={() => {
              clearError();
              signInWithEmail(email, password);
            }}
          />
          <Text style={styles.hint}>Use the email and password you registered with.</Text>
        </View>
      )}

      <View style={styles.linkRow}>
        <Text style={styles.muted}>Don't have an account? </Text>
        <Text style={styles.link} onPress={() => navigation.navigate("CreateAccount")}>
          Create one
        </Text>
      </View>

      <Text style={[styles.hint, { textAlign: "center", marginTop: 22 }]}>
        By continuing, you agree to CatchYa's{" "}
        <Text style={styles.link} onPress={() => navigation.navigate("PrivacyPolicy")}>
          Privacy Policy
        </Text>
        .
      </Text>
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: "center", padding: 26, backgroundColor: colors.background },
  brand: { marginBottom: 26 },
  h1: { fontSize: 24, fontWeight: "800", color: colors.text, marginBottom: 6 },
  sub: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  testNotice: { fontSize: 11.5, color: colors.muted, lineHeight: 16, marginTop: 10, padding: 10, backgroundColor: colors.borderSoft, borderRadius: 10 },
  forgot: { textAlign: "right", color: colors.accent, fontWeight: "700", fontSize: 12.5, marginBottom: 14 },
  hint: { fontSize: 12, color: colors.muted, marginTop: 10, lineHeight: 17 },
  bold: { fontWeight: "800", color: colors.text },
  linkRow: { flexDirection: "row", justifyContent: "center", marginTop: 18 },
  muted: { color: colors.muted, fontSize: 13.5 },
  link: { color: colors.accent, fontWeight: "700", fontSize: 13.5 },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: colors.muted, textAlign: "center", marginTop: 26 },
  futureRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 14 },
  futureItem: {
    width: 60, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderStyle: "dashed",
    borderColor: colors.border, backgroundColor: colors.borderSoft, alignItems: "center", gap: 5, opacity: 0.6,
  },
  futureLabel: { fontSize: 9.5, fontWeight: "700", color: colors.muted },
  soonBadge: { position: "absolute", top: -6, right: -4, backgroundColor: colors.border, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 },
  soonText: { fontSize: 8, fontWeight: "800", color: colors.muted },
});
