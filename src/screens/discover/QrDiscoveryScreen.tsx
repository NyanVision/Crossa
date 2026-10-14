import React, { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import QRCode from "react-native-qrcode-svg";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "@/components/Button";
import { getProfileCodeFromQr, getProfileQrPayload, resolveProfileQr } from "@/services/profileQr";
import { type Palette, radii } from "@/theme/colors";
import { useTheme, useThemedStyles } from "@/context/AppearanceContext";
import { useIsFocused } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "@/navigation/AppTabs";

type Props = NativeStackScreenProps<AppStackParamList, "QrDiscovery">;
type QrMode = "choose" | "show" | "scan";

export function QrDiscoveryScreen({ navigation, route }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const isFocused = useIsFocused();
  const [mode, setMode] = useState<QrMode>(route.params?.startInScan ? "scan" : "choose");
  const [payload, setPayload] = useState("");
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (route.params?.startInScan) setMode("scan");
  }, [route.params?.startInScan]);

  useEffect(() => {
    if (mode !== "show") return;
    getProfileQrPayload().then(setPayload).catch(() => Alert.alert("QR unavailable", "Please try again."));
  }, [mode]);

  const beginScan = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) return;
    }
    setScanned(false);
    setMode("scan");
  };

  const onBarcodeScanned = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    const profileCode = getProfileCodeFromQr(data);
    if (!profileCode) {
      Alert.alert("This QR code isn’t from CatchYa", "Try scanning a CatchYa profile code.", [
        { text: "Scan again", onPress: () => setScanned(false) },
        { text: "Done", onPress: () => setMode("choose") },
      ]);
      return;
    }
    setResolving(true);
    void resolveProfileQr(data).then((profile) => {
      if (!profile) {
        Alert.alert("Profile unavailable", "This QR code may be invalid, blocked, or belong to an unavailable account.", [
          { text: "Scan another", onPress: () => setScanned(false) },
          { text: "Done", onPress: () => setMode("choose") },
        ]);
        return;
      }
      setMode("choose");
      navigation.navigate("ProfileDetail", { profile });
    }).catch(() => {
      Alert.alert("Couldn’t load profile", "Check your connection and try scanning again.", [
        { text: "Scan again", onPress: () => setScanned(false) },
        { text: "Done", onPress: () => setMode("choose") },
      ]);
    }).finally(() => setResolving(false));
  };

  if (mode === "scan") {
    return <View style={styles.screen}>
      <View style={styles.topBar}><Pressable onPress={() => setMode("choose")} style={styles.backBtn} accessibilityLabel="Back"><Ionicons name="arrow-back" size={20} color={colors.text} /></Pressable><Text style={styles.topTitle}>Scan a QR code</Text><View style={{ width: 38 }} /></View>
      {!isFocused ? <View style={styles.cameraWrap} /> : !permission?.granted ? <View style={styles.permissionWrap}><View style={styles.iconBubble}><Ionicons name="camera-outline" size={26} color={colors.accent} /></View><Text style={styles.heading}>Allow camera access to scan</Text><Text style={styles.body}>Camera access is used only when you choose to scan. Your location stays off.</Text><Button label="Allow camera access" variant="primary" onPress={beginScan} /><Button label="Cancel" onPress={() => setMode("choose")} style={{ marginTop: 10 }} /></View> : <View style={styles.cameraWrap}><CameraView style={styles.camera} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={scanned || resolving ? undefined : onBarcodeScanned} /><View pointerEvents="none" style={styles.scanOverlay}><View style={styles.scanFrame} /><Text style={styles.scanHint}>{resolving ? "Loading CatchYa profile…" : "Place a CatchYa QR code inside the frame"}</Text></View></View>}
    </View>;
  }

  if (mode === "show") {
    return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.topBar}><Pressable onPress={() => setMode("choose")} style={styles.backBtn} accessibilityLabel="Back"><Ionicons name="arrow-back" size={20} color={colors.text} /></Pressable><Text style={styles.topTitle}>Your CatchYa QR</Text><View style={{ width: 38 }} /></View>
      <View style={styles.qrPage}>
        <Text style={styles.heading}>Let someone scan your code</Text><Text style={styles.body}>They can find your CatchYa profile in person. Your code contains no location or contact details.</Text>
        <View style={styles.qrPaper}>{payload ? <QRCode value={payload} size={220} color="#20262D" backgroundColor="#FFFFFF" /> : <Ionicons name="qr-code-outline" size={120} color={colors.border} />}</View>
        <View style={styles.safeNote}><Ionicons name="lock-closed-outline" size={17} color={colors.success} /><Text style={styles.safeCopy}>Location access is not used for QR discovery.</Text></View>
      </View>
    </ScrollView>;
  }

  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    <View style={styles.topBar}><Pressable onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityLabel="Back"><Ionicons name="arrow-back" size={20} color={colors.text} /></Pressable><Text style={styles.topTitle}>QR discovery</Text><View style={{ width: 38 }} /></View>
    <View style={styles.heroIcon}><Ionicons name="qr-code-outline" size={31} color={colors.accent} /></View>
    <Text style={styles.heading}>Connect face to face</Text>
    <Text style={styles.body}>Show your CatchYa QR code or scan someone else’s. QR discovery works without location access.</Text>
    <View style={styles.actions}><Button label="Show my QR code" variant="primary" onPress={() => setMode("show")} /><Button label="Scan a QR code" icon={<Ionicons name="scan-outline" size={18} color={colors.text} />} onPress={beginScan} style={{ marginTop: 10 }} /></View>
    <View style={styles.safeNote}><Ionicons name="location-outline" size={17} color={colors.success} /><Text style={styles.safeCopy}>Nearby discovery stays off unless you turn it on separately.</Text></View>
  </ScrollView>;
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, padding: 22 },
  topBar: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 24 },
  backBtn: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  topTitle: { color: colors.text, fontSize: 16, fontWeight: "800" },
  heroIcon: { alignSelf: "center", width: 76, height: 76, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: colors.accentSoft, marginTop: 28, marginBottom: 18 },
  heading: { color: colors.text, fontSize: 23, lineHeight: 29, fontWeight: "800", textAlign: "center", marginBottom: 8 },
  body: { color: colors.muted, fontSize: 14, lineHeight: 21, textAlign: "center", marginBottom: 24, paddingHorizontal: 6 },
  actions: { marginTop: 8 },
  safeNote: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", marginTop: 24, paddingHorizontal: 12 },
  safeCopy: { color: colors.muted, fontSize: 12, lineHeight: 17, flexShrink: 1 },
  qrPage: { flex: 1, alignItems: "center", paddingTop: 26 },
  qrPaper: { width: 270, height: 270, alignItems: "center", justifyContent: "center", backgroundColor: colors.qrPaper, borderRadius: radii.lg, marginTop: 7, borderWidth: 1, borderColor: colors.border },
  cameraWrap: { flex: 1, backgroundColor: colors.overlayInk, margin: 16, borderRadius: radii.lg, overflow: "hidden" },
  camera: { flex: 1 },
  scanOverlay: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  scanFrame: { width: 250, height: 250, borderWidth: 3, borderColor: "#FFFFFF", borderRadius: 24, backgroundColor: "transparent" },
  scanHint: { color: "#FFFFFF", fontSize: 13, fontWeight: "700", textAlign: "center", marginTop: 22, paddingHorizontal: 20 },
  permissionWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 26 },
  iconBubble: { width: 60, height: 60, borderRadius: 20, backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center", marginBottom: 16 },
});
