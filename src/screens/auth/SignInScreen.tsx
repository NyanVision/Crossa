import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/context/AuthContext";
import { isSupabaseConfigured } from "@/services/supabase";
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
      <View style={styles.brand}><Text style={styles.h1}>Sign in</Text><Text style={styles.sub}>Sign in to your Crossa account to continue.</Text>
        {!isSupabaseConfigured ? <Text style={styles.testNotice}>Backend not configured yet. Add your Supabase URL and publishable key to the local .env file.</Text> : null}
      </View>
      <Banner message={error} />
      <Button label="Continue with Google" variant="default" loading={loading} disabled={!isSupabaseConfigured || loading} onPress={() => { clearError(); void signInWithGoogle(); }} icon={<Ionicons name="logo-google" size={18} color="#4285F4" />} />
      <View style={{ height: 10 }} />
      <Button label="Continue with email" disabled={!isSupabaseConfigured || loading} onPress={() => setShowEmailForm((value) => !value)} icon={<Ionicons name="mail-outline" size={18} color={colors.text} />} />
      {showEmailForm ? <View style={{ marginTop: 14 }}>
        <TextField label="Email" keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} placeholder="you@example.com" />
        <TextField label="Password" secureTextEntry value={password} onChangeText={setPassword} placeholder="••••••••" />
        <Text style={styles.forgot} onPress={() => navigation.navigate("ResetPassword")}>Forgot password?</Text>
        <Button label="Sign in" variant="primary" loading={loading} disabled={!isSupabaseConfigured || loading} onPress={() => { clearError(); void signInWithEmail(email, password); }} />
      </View> : null}
      <View style={styles.linkRow}><Text style={styles.muted}>Don't have an account? </Text><Text style={styles.link} onPress={() => navigation.navigate("CreateAccount")}>Create one</Text></View>
      <Text style={[styles.hint, { textAlign: "center", marginTop: 22 }]}>By continuing, you agree to Crossa's <Text style={styles.link} onPress={() => navigation.navigate("PrivacyPolicy")}>Privacy Policy</Text>.</Text>
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
  linkRow: { flexDirection: "row", justifyContent: "center", marginTop: 18 },
  muted: { color: colors.muted, fontSize: 13.5 },
  link: { color: colors.accent, fontWeight: "700", fontSize: 13.5 },
});
