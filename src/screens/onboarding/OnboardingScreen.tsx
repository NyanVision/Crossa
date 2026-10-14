import React, { useEffect, useState } from "react";
import { Alert, Image, ScrollView, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/Button";
import { TextField } from "@/components/TextField";
import { pickProfilePhoto, takeProfilePhoto } from "@/services/imageUpload";
import { emptyProfile, saveProfile } from "@/services/profileStorage";
import { type Palette } from "@/theme/colors";
import { useThemedStyles } from "@/context/AppearanceContext";

export function OnboardingScreen() {
  const styles = useThemedStyles(makeStyles);
  const { completeOnboarding, userId } = useAuth();
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [bio, setBio] = useState("");
  const [instagram, setInstagram] = useState("");
  const [telegram, setTelegram] = useState("");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    if (!userId) return () => { active = false; };
    const key = `catchya:onboardingDraft:${userId}`;
    void AsyncStorage.getItem(key).then((raw) => {
      if (!active || !raw) return;
      const draft = JSON.parse(raw) as { name?: string; age?: string; bio?: string; instagram?: string; telegram?: string };
      setName(draft.name ?? ""); setAge(draft.age ?? ""); setBio(draft.bio ?? "");
      setInstagram(draft.instagram ?? ""); setTelegram(draft.telegram ?? "");
    }).catch(() => undefined);
    return () => { active = false; };
  }, [userId]);

  const saveDraft = (patch: Partial<{ name: string; age: string; bio: string; instagram: string; telegram: string }>) => {
    const next = { name, age, bio, instagram, telegram, ...patch };
    if (userId) void AsyncStorage.setItem(`catchya:onboardingDraft:${userId}`, JSON.stringify(next)).catch(() => undefined);
  };

  const save = async () => {
    if (!name.trim()) { Alert.alert("Add a display name", "Enter the name you want people to see on your profile."); return; }
    const numericAge = age.trim() ? Number(age) : null;
    if (numericAge !== null && (!Number.isInteger(numericAge) || numericAge < 13 || numericAge > 120)) {
      Alert.alert("Check your age", "Enter an age between 13 and 120, or leave it blank.");
      return;
    }
    setSaving(true);
    try {
      const profile = emptyProfile(userId);
      profile.name = name.trim();
      profile.age = numericAge;
      profile.bio = bio.trim();
      profile.photoUri = photoUri;
      profile.links = profile.links.map((link) => link.platform === "instagram"
        ? { ...link, handle: instagram.trim(), hidden: true }
        : link.platform === "telegram" ? { ...link, handle: telegram.trim(), hidden: true } : link);
      await saveProfile(profile);
      await completeOnboarding();
      if (userId) await AsyncStorage.removeItem(`catchya:onboardingDraft:${userId}`);
    } catch {
      Alert.alert("Couldn’t save your profile", "Check your connection and try again.");
    } finally { setSaving(false); }
  };

  return (
    <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Set up your profile</Text>
      <View style={styles.photoRow}>
        <View style={styles.photoPreview}>{photoUri ? <Image source={{ uri: photoUri }} style={styles.photoImg} /> : <Text style={styles.photoInitial}>{(name || "Y").slice(0, 1).toUpperCase()}</Text>}</View>
        <View style={{ gap: 8, flex: 1 }}>
          <Button label="Choose photo" onPress={async () => setPhotoUri((await pickProfilePhoto()) ?? photoUri)} />
          <Button label="Take photo" onPress={async () => setPhotoUri((await takeProfilePhoto()) ?? photoUri)} />
        </View>
      </View>
      <TextField label="Display name" value={name} onChangeText={(value) => { setName(value); saveDraft({ name: value }); }} placeholder="How others will see you" maxLength={40} />
      <TextField label="Age (optional)" value={age} onChangeText={(value) => { const next = value.replace(/\D/g, "").slice(0, 3); setAge(next); saveDraft({ age: next }); }} placeholder="13 or older" keyboardType="number-pad" maxLength={3} />
      <TextField label="Short bio" value={bio} onChangeText={(value) => { setBio(value); saveDraft({ bio: value }); }} placeholder="One line about you" maxLength={120} />
      <Text style={styles.sectionTitle}>Add social links</Text>
      <Text style={styles.hint}>You type these in yourself — CatchYa never pulls from your accounts. You can hide any link later. Social links are never used to sign in.</Text>
      <TextField label="Instagram" value={instagram} onChangeText={(value) => { setInstagram(value); saveDraft({ instagram: value }); }} placeholder="@username" />
      <TextField label="Telegram" value={telegram} onChangeText={(value) => { setTelegram(value); saveDraft({ telegram: value }); }} placeholder="@username" />
      <Button label="Continue" variant="primary" loading={saving} disabled={saving} onPress={() => void save()} />
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
