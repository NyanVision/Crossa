import { SocialLogo } from "@/components/SocialLogo";
import React, { useEffect, useMemo, useState } from "react";
import { Alert, Image, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/Button";
import { pickProfilePhoto, takeProfilePhoto } from "@/services/imageUpload";
import { emptyProfile, loadProfile, saveProfile } from "@/services/profileStorage";
import type { CurrentUser, SocialPlatform } from "@/types";
import { socialProfileUrl } from "@/services/socialLinks";
import { type Palette, radii } from "@/theme/colors";
import { useTheme, useThemedStyles } from "@/context/AppearanceContext";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "@/navigation/AppTabs";

type Props = NativeStackScreenProps<AppStackParamList, "EditProfile">;
const platforms: SocialPlatform[] = ["facebook", "telegram", "x", "tiktok", "instagram", "line", "whatsapp", "wechat"];
const platformLabels: Record<SocialPlatform, string> = {
  facebook: "Facebook", telegram: "Telegram", x: "X", tiktok: "TikTok",
  instagram: "Instagram", line: "LINE", whatsapp: "WhatsApp", wechat: "WeChat",
};
const getPlatformColors = (colors: Palette): Record<SocialPlatform, string> => ({
  facebook: "#1877F2", telegram: "#229ED9", x: colors.text, tiktok: colors.text,
  instagram: "#C13584", line: "#06C755", whatsapp: "#25D366", wechat: "#07C160",
});

export function EditProfileScreen({ navigation }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors, isDark } = useTheme();
  const platformColors = getPlatformColors(colors);
  const { userId } = useAuth();
  const [profile, setProfile] = useState<CurrentUser>(emptyProfile(userId));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedPlatforms, setSelectedPlatforms] = useState<SocialPlatform[]>([]);
  const [choosingPlatform, setChoosingPlatform] = useState(false);
  const addedPlatforms = platforms.filter((platform) =>
    selectedPlatforms.includes(platform) || profile.links.some((link) => link.platform === platform && link.handle.trim())
  );
  const availablePlatforms = platforms.filter((platform) => !addedPlatforms.includes(platform));

  useEffect(() => {
    let active = true;
    loadProfile(userId).then((saved) => { if (active) setProfile(saved); })
      .catch(() => Alert.alert("Couldn’t load profile", "Your saved profile couldn’t be opened."))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId]);

  const visibleLinks = useMemo(
    () => profile.links.filter((link) => !link.hidden && link.handle.trim().length > 0),
    [profile.links]
  );

  const updateProfile = (update: Partial<CurrentUser>) => setProfile((current) => ({ ...current, ...update }));
  const updateLink = (platform: SocialPlatform, update: Partial<CurrentUser["links"][number]>) => {
    setProfile((current) => ({
      ...current,
      links: current.links.map((link) => link.platform === platform ? { ...link, ...update } : link),
    }));
  };

  const changePhoto = async (picker: () => Promise<string | null>) => {
    const uri = await picker();
    if (uri) updateProfile({ photoUri: uri });
  };

  const save = async () => {
    const invalidVisibleLink = profile.links.find((link) => !link.hidden && link.handle.trim() && !socialProfileUrl(link.platform, link.handle));
    if (invalidVisibleLink) {
      Alert.alert("Check this account link", `Enter a valid ${platformLabels[invalidVisibleLink.platform]} username or profile URL before making it visible.`);
      return;
    }
    const name = profile.name.trim();
    if (!name) {
      Alert.alert("Add a display name", "Enter the name you want people to see on your profile.");
      return;
    }
    if (profile.age !== null && (!Number.isInteger(profile.age) || profile.age < 13 || profile.age > 120)) {
      Alert.alert("Check your age", "Enter an age between 13 and 120, or leave it blank.");
      return;
    }
    setSaving(true);
    try {
      await saveProfile({ ...profile, name, bio: profile.bio.trim() });
      navigation.goBack();
    } catch {
      Alert.alert("Couldn’t save profile", "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.photoSection}>
          <View style={styles.photoWrap}>
            {profile.photoUri ? <Image source={{ uri: profile.photoUri }} style={styles.photo} /> : <View style={styles.photoPlaceholder}><Ionicons name="person" size={36} color={colors.muted} /></View>}
            <Pressable style={styles.cameraBadge} onPress={() => changePhoto(takeProfilePhoto)} accessibilityRole="button" accessibilityLabel="Take a profile photo"><Ionicons name="camera" size={16} color={colors.accentInk} /></Pressable>
          </View>
          <Text style={styles.photoTitle}>Profile photo</Text>
          <View style={styles.photoActions}>
            <Pressable onPress={() => changePhoto(pickProfilePhoto)} accessibilityRole="button"><Text style={styles.photoAction}>Choose photo</Text></Pressable>
            <View style={styles.actionSeparator} />
            <Pressable onPress={() => changePhoto(takeProfilePhoto)} accessibilityRole="button"><Text style={styles.photoAction}>Take photo</Text></Pressable>
            {profile.photoUri ? <><View style={styles.actionSeparator} /><Pressable onPress={() => updateProfile({ photoUri: null })} accessibilityRole="button"><Text style={[styles.photoAction, styles.removeText]}>Remove</Text></Pressable></> : null}
          </View>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.fieldLabel}>Display name</Text>
          <TextInput keyboardAppearance={isDark ? "dark" : "light"} value={profile.name} onChangeText={(name) => updateProfile({ name })} placeholder="Your name" placeholderTextColor={colors.muted} maxLength={40} autoCapitalize="words" returnKeyType="next" style={styles.input} />
          <Text style={styles.fieldLabel}>Age</Text>
          <TextInput keyboardAppearance={isDark ? "dark" : "light"} value={profile.age == null ? "" : String(profile.age)} onChangeText={(value) => updateProfile({ age: value.trim() ? Number(value.replace(/\D/g, "").slice(0, 3)) : null })} placeholder="Optional" placeholderTextColor={colors.muted} maxLength={3} keyboardType="number-pad" style={styles.input} />
          <View style={styles.fieldHeading}><Text style={styles.fieldLabel}>Short bio</Text><Text style={styles.counter}>{profile.bio.length}/120</Text></View>
          <TextInput keyboardAppearance={isDark ? "dark" : "light"} value={profile.bio} onChangeText={(bio) => updateProfile({ bio })} placeholder="A little about you (optional)" placeholderTextColor={colors.muted} maxLength={120} multiline textAlignVertical="top" style={[styles.input, styles.bioInput]} />
        </View>

        <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Social accounts</Text><Text style={styles.optional}>Optional</Text></View>
        <Text style={styles.sectionDescription}>Choose an app, then add your username or profile link. Visible accounts can be opened by other users.</Text>

        <View style={styles.previewCard}>
          <Text style={styles.previewHeading}>Profile preview</Text>
          <View style={styles.previewIdentity}>
            {profile.photoUri ? <Image source={{ uri: profile.photoUri }} style={styles.previewPhoto} /> : <View style={styles.previewPhotoPlaceholder}><Ionicons name="person" size={17} color={colors.muted} /></View>}
            <View style={{ flex: 1 }}><Text style={styles.previewName}>{profile.name.trim() || "Your display name"}</Text><Text style={styles.previewBio} numberOfLines={2}>{profile.bio.trim() || "Your bio will appear here"}</Text></View>
          </View>
          <Text style={styles.previewContactTitle}>Social accounts</Text>
          {visibleLinks.length ? visibleLinks.map((link) => <View style={styles.previewLink} key={link.platform}><View style={[styles.miniPlatformIcon, { backgroundColor: `${platformColors[link.platform]}14` }]}><SocialLogo platform={link.platform} size={14} /></View><Text style={styles.previewPlatform}>{platformLabels[link.platform]}</Text><Text style={styles.previewHandle} numberOfLines={1}>{link.handle.trim()}</Text></View>) : <Text style={styles.previewEmpty}>Visible accounts you add will appear here.</Text>}
        </View>

        <Text style={styles.linksHeading}>Social accounts</Text>
        <Button label={choosingPlatform ? "Close app picker" : "Add social account"} disabled={loading || saving || availablePlatforms.length === 0} onPress={() => setChoosingPlatform((current) => !current)} />
        {choosingPlatform ? <View style={styles.previewCard}>
          <Text style={styles.sectionTitle}>Which app would you like to add?</Text>
          {availablePlatforms.map((platform) => <Pressable key={platform} accessibilityRole="button" accessibilityLabel={`Add ${platformLabels[platform]}`} style={styles.socialRow} onPress={() => {
            setSelectedPlatforms((current) => [...current, platform]);
            updateLink(platform, { hidden: false });
            setChoosingPlatform(false);
          }}>
            <SocialLogo platform={platform} />
            <Text style={styles.platformName}>{platformLabels[platform]}</Text>
          </Pressable>)}
        </View> : null}
        <View style={styles.linksCard}>
          {addedPlatforms.map((platform, index) => {
            const link = profile.links.find((item) => item.platform === platform)!;
            const canShow = Boolean(link.handle.trim());
            return <View key={platform} style={[styles.socialRow, index > 0 && styles.rowBorder]}>
              <View style={[styles.platformIcon, { backgroundColor: `${platformColors[platform]}14` }]}><SocialLogo platform={platform} size={18} /></View>
              <View style={styles.socialContent}>
                <View style={styles.socialHeader}><Text style={styles.platformName}>{platformLabels[platform]}</Text><View style={styles.visibilityControl}><Text style={styles.visibilityLabel}>{!link.hidden && canShow ? "Visible" : "Hidden"}</Text><Switch value={!link.hidden && canShow} onValueChange={(visible) => updateLink(platform, { hidden: !visible })} disabled={!canShow} trackColor={{ false: colors.border, true: colors.accent }} thumbColor={!link.hidden && canShow ? colors.success : colors.surface} accessibilityLabel={`${platformLabels[platform]} visibility`} /></View></View>
                <TextInput keyboardAppearance={isDark ? "dark" : "light"} value={link.handle} onChangeText={(handle) => updateLink(platform, { handle, hidden: handle.trim() ? link.hidden : true })} accessibilityLabel={`${platformLabels[platform]} username or profile link`} maxLength={256} placeholder={platform === "facebook" ? "facebook.com/yourname or profile URL" : "Username or profile link"} placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={styles.socialInput} returnKeyType="done" />
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${platformLabels[platform]} account`} onPress={() => {
                  updateLink(platform, { handle: "", hidden: true });
                  setSelectedPlatforms((current) => current.filter((item) => item !== platform));
                }} style={{ minHeight: 44, justifyContent: "center" }}><Text style={styles.removeText}>Remove account</Text></Pressable>
              </View>
            </View>;
          })}
        </View>
        <Text style={styles.privacyNote}>Social links are optional. Hidden or empty accounts won’t appear on your public profile.</Text>
      </ScrollView>

      <View style={styles.footer}>
        <Button label="Cancel" onPress={() => navigation.goBack()} style={styles.cancelButton} />
        <Button label="Save" variant="primary" onPress={save} loading={saving || loading} disabled={loading} style={styles.saveButton} />
      </View>
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 18, paddingBottom: 24 },
  photoSection: { alignItems: "center", paddingVertical: 8, marginBottom: 13 },
  photoWrap: { position: "relative", marginBottom: 9 },
  photo: { width: 96, height: 96, borderRadius: 32, backgroundColor: colors.borderSoft },
  photoPlaceholder: { width: 96, height: 96, borderRadius: 32, backgroundColor: colors.borderSoft, alignItems: "center", justifyContent: "center" },
  cameraBadge: { position: "absolute", right: -3, bottom: -3, width: 31, height: 31, borderRadius: 16, borderWidth: 3, borderColor: colors.background, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  photoTitle: { color: colors.text, fontSize: 13, fontWeight: "800" },
  photoActions: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8 },
  photoAction: { color: colors.accent, fontSize: 11.5, fontWeight: "700" },
  removeText: { color: colors.danger },
  actionSeparator: { width: 1, height: 14, backgroundColor: colors.border },
  formCard: { padding: 14, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: 18 },
  fieldLabel: { color: colors.text, fontSize: 12.5, fontWeight: "800", marginBottom: 7 },
  input: { minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm + 1, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, fontSize: 14, backgroundColor: colors.surface, marginBottom: 14 },
  fieldHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  counter: { color: colors.muted, fontSize: 10.5, marginBottom: 7 },
  bioInput: { height: 86, marginBottom: 0 },
  sectionHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "800" },
  optional: { color: colors.muted, fontSize: 11 },
  sectionDescription: { color: colors.muted, fontSize: 11.5, lineHeight: 17, marginBottom: 11 },
  previewCard: { padding: 13, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: 18 },
  previewHeading: { color: colors.muted, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 11 },
  previewIdentity: { flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: 11, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  previewPhoto: { width: 40, height: 40, borderRadius: 15, backgroundColor: colors.borderSoft },
  previewPhotoPlaceholder: { width: 40, height: 40, borderRadius: 15, backgroundColor: colors.borderSoft, alignItems: "center", justifyContent: "center" },
  previewName: { color: colors.text, fontSize: 12.5, fontWeight: "800" },
  previewBio: { color: colors.muted, fontSize: 10.5, marginTop: 3 },
  previewContactTitle: { color: colors.text, fontSize: 11.5, fontWeight: "800", marginTop: 11, marginBottom: 6 },
  previewLink: { flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 5 },
  miniPlatformIcon: { width: 24, height: 24, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  previewPlatform: { color: colors.text, fontSize: 10.5, fontWeight: "700", width: 76 },
  previewHandle: { color: colors.muted, fontSize: 10.5, flex: 1 },
  previewEmpty: { color: colors.muted, fontSize: 10.5, paddingVertical: 5 },
  linksHeading: { color: colors.text, fontSize: 14, fontWeight: "800", marginBottom: 8 },
  linksCard: { paddingHorizontal: 12, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  socialRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 12 },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.borderSoft },
  platformIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center", marginTop: 2 },
  socialContent: { flex: 1, minWidth: 0 },
  socialHeader: { minHeight: 28, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  platformName: { color: colors.text, fontSize: 12, fontWeight: "800" },
  visibilityControl: { flexDirection: "row", alignItems: "center", gap: 4 },
  visibilityLabel: { color: colors.muted, fontSize: 10 },
  socialInput: { minHeight: 39, borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7, marginTop: 5, color: colors.text, backgroundColor: colors.surface, fontSize: 12 },
  privacyNote: { color: colors.muted, fontSize: 10.5, lineHeight: 15, marginTop: 9, marginBottom: 12, textAlign: "center" },
  footer: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.borderSoft, backgroundColor: colors.background },
  cancelButton: { flex: 1 },
  saveButton: { flex: 1 },
});
