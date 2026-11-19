import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/Button";
import { TextField } from "@/components/TextField";
import { type Palette } from "@/theme/colors";
import { useThemedStyles } from "@/context/AppearanceContext";
import { Banner } from "@/components/Banner";
import { passwordValidationError } from "@/services/authLinks";

export function ResetPasswordScreen() {
  const styles = useThemedStyles(makeStyles);
  const { resetPassword, updatePassword, signOut, status, recoveryComplete, loading, error, clearError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const recovering = status === "recovering";

  const leaveRecovery = async () => {
    try { await signOut(); }
    catch { setFormError("Could not sign out. Check your connection and try again."); }
  };

  if (recovering && recoveryComplete) return (
    <View style={styles.wrap}>
      <Text style={styles.intro}>Your password has been changed. Sign in with your new password.</Text>
      <Banner message={formError} />
      <Button label="Done" onPress={leaveRecovery} />
    </View>
  );

  return (
    <View style={styles.wrap}>
      <Text style={styles.intro}>{recovering ? "Choose a new password with at least 8 characters." : "We'll email you a reset link. Open it on this device to choose a new password."}</Text>
      <Banner message={formError ?? error} />
      {recovering ? <>
        <TextField label="New password" value={password} onChangeText={setPassword} secureTextEntry textContentType="newPassword" autoComplete="new-password" editable={!loading} />
        <TextField label="Confirm new password" value={confirmation} onChangeText={setConfirmation} secureTextEntry textContentType="newPassword" autoComplete="new-password" editable={!loading} />
        <Button label="Save new password" loading={loading} disabled={!password || !confirmation} onPress={async () => {
          const problem = passwordValidationError(password, confirmation);
          setFormError(problem);
          if (problem) return;
          try {
            await updatePassword(password);
            setPassword("");
            setConfirmation("");
          } catch (cause) {
            setFormError(cause instanceof Error ? cause.message : "Could not update your password. Request a new reset link.");
          }
        }} />
        <Button label="Cancel and sign out" variant="ghost" disabled={loading} onPress={leaveRecovery} />
      </> : <>
      <TextField label="Email" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="you@example.com" />
      <Button
        label={sent ? "Send another reset link" : "Send reset link"}
        variant="primary"
        loading={loading}
        disabled={!email}
        onPress={async () => {
          clearError();
          setFormError(null);
          await resetPassword(email);
          setSent(true);
        }}
      />
      </>}
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  wrap: { flex: 1, padding: 20, backgroundColor: colors.background },
  intro: { fontSize: 13, color: colors.muted, marginBottom: 16, lineHeight: 19 },
});

