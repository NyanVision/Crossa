import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/Button";
import { TextField } from "@/components/TextField";
import { type Palette } from "@/theme/colors";
import { useThemedStyles } from "@/context/AppearanceContext";
import { Banner } from "@/components/Banner";

export function ResetPasswordScreen() {
  const styles = useThemedStyles(makeStyles);
  const { resetPassword, loading, error } = useAuth();
  const [email, setEmail] = useState("");


  return (
    <View style={styles.wrap}>
      <Text style={styles.intro}>Enter your account email. Open the reset link on this device to choose a new password.</Text>
      <Banner message={error} />
      <TextField label="Email" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="you@example.com" />
      <Button
        label="Send reset link"
        variant="primary"
        loading={loading}
        disabled={!email}
        onPress={async () => {
          await resetPassword(email);
        }}
      />
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  wrap: { flex: 1, padding: 20, backgroundColor: colors.background },
  intro: { fontSize: 13, color: colors.muted, marginBottom: 16, lineHeight: 19 },
});
