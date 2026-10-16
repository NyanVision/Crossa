import React, { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ScrollView, StyleSheet, Text } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { isSupabaseConfigured } from "@/services/supabase";
import { Button } from "@/components/Button";
import { TextField } from "@/components/TextField";
import { Banner } from "@/components/Banner";
import { type Palette } from "@/theme/colors";
import { useThemedStyles } from "@/context/AppearanceContext";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AuthStackParamList } from "@/navigation/AuthNavigator";

type Props = NativeStackScreenProps<AuthStackParamList, "CreateAccount">;

export function CreateAccountScreen({ navigation }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { createAccount, signInWithGoogle, error, loading, clearError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const onSubmit = () => {
    clearError();
    if (password !== confirm) { setLocalError("Passwords don't match."); return; }
    setLocalError(null);
    void createAccount(email, password);
  };

  return (
    <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
      {!isSupabaseConfigured ? <Text style={styles.notice}>Backend not configured yet. Add your Supabase URL and publishable key to the local .env file.</Text> : null}
      <Banner message={localError ?? error} />
      <Button label="Continue with Google" loading={loading} disabled={!isSupabaseConfigured || loading} onPress={() => { clearError(); void signInWithGoogle(); }} icon={<Ionicons name="logo-google" size={18} color="#4285F4" />} />
      <Text style={styles.hint}>Or create an account with email</Text>
      <TextField label="Email" keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} placeholder="you@example.com" />
      <TextField label="Password" secureTextEntry value={password} onChangeText={setPassword} placeholder="At least 8 characters" />
      <TextField label="Confirm password" secureTextEntry value={confirm} onChangeText={setConfirm} placeholder="Re-enter password" />
      <Button label="Create account" variant="primary" loading={loading} disabled={!isSupabaseConfigured || loading} onPress={onSubmit} />
      <Text style={styles.link} onPress={() => navigation.navigate("SignIn")}>Already have an account? Sign in</Text>
      <Text style={styles.hint}>By creating an account, you agree to Crossa's <Text style={styles.linkInline} onPress={() => navigation.navigate("PrivacyPolicy")}>Privacy Policy</Text>.</Text>
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  wrap: { flexGrow: 1, padding: 20, backgroundColor: colors.background },
  notice: { fontSize: 11.5, color: colors.muted, lineHeight: 16, marginBottom: 14, padding: 10, backgroundColor: colors.borderSoft, borderRadius: 10 },
  link: { textAlign: "center", color: colors.accent, fontWeight: "700", fontSize: 13.5, marginTop: 16 },
  linkInline: { color: colors.accent, fontWeight: "700" },
  hint: { fontSize: 12, color: colors.muted, textAlign: "center", marginTop: 18, lineHeight: 17 },
});
