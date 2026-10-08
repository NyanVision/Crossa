import React, { useState } from "react";
import { Alert, Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/Button";
import { emptyProfile, saveProfile } from "@/services/profileStorage";
import { socialProfileUrl } from "@/services/socialLinks";
import { TextField } from "@/components/TextField";
import { pickProfilePhoto, takeProfilePhoto } from "@/services/imageUpload";
import { type Palette } from "@/theme/colors";
import { useThemedStyles } from "@/context/AppearanceContext";

export function OnboardingScreen() {
  const styles = useThemedStyles(makeStyles);
  const { userId, completeOnboarding } = useAuth();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [instagram, setInstagram] = useState("");
  const [telegram, setTelegram] = useState("");
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  const finish = async () => {
    setSaving(true);
    try {
      const profile = { ...emptyProfile(userId), name, bio, photoUri };
      profile.links = profile.links.map(link => {
        const handle = link.platform === 'instagram' ? instagram.trim() : link.platform === 'telegram' ? telegram.trim() : '';
        if (handle && !socialProfileUrl(link.platform, handle)) throw new Error('Enter a valid social username or profile URL.');
        return { ...link, handle, hidden: !handle };
      });
      await saveProfile(profile);
      await completeOnboarding();
    } catch (error) { Alert.alert('Couldn’t save profile', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setSaving(false); }
  };

  return (
    <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Set up your profile</Text>

      <View style={styles.photoRow}>
        <View style={styles.photoPreview}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.photoImg} />
          ) : (
            <Text style={styles.photoInitial}>{(name || "Y").slice(0, 1).toUpperCase()}</Text>
          )}
        </View>
        <View style={{ gap: 8, flex: 1 }}>
          <Button label="Choose photo" onPress={async () => setPhotoUri((await pickProfilePhoto()) ?? photoUri)} />
          <Button label="Take photo" onPress={async () => setPhotoUri((await takeProfilePhoto()) ?? photoUri)} />
        </View>
      </View>

      <TextField label="Display name" value={name} onChangeText={setName} placeholder="How others will see you" />
      <TextField label="Short bio" value={bio} onChangeText={setBio} placeholder="One line about you" />

      <Text style={styles.sectionTitle}>Add social links</Text>
      <Text style={styles.hint}>
        You type these in yourself — CatchYa never pulls from your accounts. You can hide any link
        later.
      </Text>
      <TextField label="Instagram" value={instagram} onChangeText={setInstagram} placeholder="@username" />
      <TextField label="Telegram" value={telegram} onChangeText={setTelegram} placeholder="@username" />

      <Button label="Continue" variant="primary" onPress={finish} loading={saving} />
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  wrap: { flexGrow: 1, padding: 20, backgroundColor: colors.background },
  title: { fontSize: 19, fontWeight: "800", color: colors.text, marginBottom: 18 },
  photoRow: { flexDirection: "row", gap: 14, marginBottom: 18, alignItems: "center" },
  photoPreview: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  photoImg: { width: 64, height: 64 },
  photoInitial: { color: colors.accentInk, fontWeight: "800", fontSize: 22 },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: colors.muted, marginTop: 4, marginBottom: 2 },
  hint: { fontSize: 12, color: colors.muted, marginBottom: 12, lineHeight: 17 },
});
