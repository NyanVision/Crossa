import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/Button";
import { TextField } from "@/components/TextField";
import { type Palette } from "@/theme/colors";
import { useThemedStyles } from "@/context/AppearanceContext";
import { Banner } from "@/components/Banner";

export function ResetPasswordScreen() {
  const styles = useThemedStyles(makeStyles);
  const { resetPassword, updatePassword, finishPasswordRecovery, recoveryMode, recoveryComplete, userId, loading, error } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const requestAnotherLink = () => {
    setLocalError(null);
    void resetPassword(email);
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {recoveryComplete ? (
          <View style={styles.successCard}>
            <Text style={styles.successTitle}>Password updated</Text>
            <Text style={styles.successCopy}>Your CatchYa password has been changed. Continue to your account when you’re ready.</Text>
            <Button label="Continue" variant="primary" loading={loading} onPress={() => {
              setLocalError(null);
              void finishPasswordRecovery().catch((cause) => setLocalError(cause instanceof Error ? cause.message : "Could not continue. Request a new password reset link."));
            }} />
            {localError ? <Text style={styles.inlineError}>{localError}</Text> : null}
          </View>
        ) : recoveryMode && !userId ? (
          <View>
            <Text style={styles.intro}>This password reset link could not be verified or has expired. Request a new link to continue.</Text>
            <Banner message={localError ?? error} />
            <TextField label="Email" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="you@example.com" />
            <Button label="Request a new reset link" variant="primary" loading={loading} disabled={!email.trim()} onPress={requestAnotherLink} />
          </View>
        ) : recoveryMode ? (
          <View>
            <Text style={styles.intro}>Choose a new password for your CatchYa account.</Text>
            <Banner message={localError ?? error} />
            <TextField label="New password" value={password} onChangeText={setPassword} placeholder="At least 8 characters" secureTextEntry />
            <TextField label="Confirm new password" value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Re-enter your password" secureTextEntry />
            <Button label="Update password" variant="primary" loading={loading} disabled={!password || !confirmPassword} onPress={async () => {
              setLocalError(null);
              if (password !== confirmPassword) { setLocalError("The passwords do not match."); return; }
              try { await updatePassword(password); } catch (cause) { setLocalError(cause instanceof Error ? cause.message : "Could not update your password."); }
            }} />
            <Text style={styles.recoveryHint}>Link expired? Enter the account email below to request another reset link.</Text>
            <TextField label="Email" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="you@example.com" />
            <Button label="Send another reset link" loading={loading} disabled={!email.trim()} onPress={requestAnotherLink} />
          </View>
        ) : (
          <View>
            <Text style={styles.intro}>We’ll email you a secure link to reset your password.</Text>
            <Banner message={localError ?? error} />
            <TextField label="Email" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="you@example.com" />
            <Button label="Send reset link" variant="primary" loading={loading} disabled={!email.trim()} onPress={() => void resetPassword(email)} />
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, padding: 20, justifyContent: "center" },
  intro: { fontSize: 13, color: colors.muted, marginBottom: 16, lineHeight: 19 },
  recoveryHint: { color: colors.muted, fontSize: 11.5, lineHeight: 17, marginTop: 18, marginBottom: 9 },
  successCard: { padding: 18, borderRadius: 16, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  successTitle: { fontSize: 18, fontWeight: "800", color: colors.text, marginBottom: 7 },
  successCopy: { fontSize: 13, color: colors.muted, lineHeight: 19, marginBottom: 18 },
  inlineError: { color: colors.danger, fontSize: 12, marginTop: 10 },
});
