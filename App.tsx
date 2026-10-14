import React from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { AppearanceProvider, useAppAppearance } from "@/context/AppearanceContext";
import { RootNavigator } from "@/navigation/RootNavigator";

function AppContent() {
  const { ready: appearanceReady, colors, scheme } = useAppAppearance();
  const { ready: authReady } = useAuth();
  if (!appearanceReady || !authReady) return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  return <><StatusBar style={scheme === "dark" ? "light" : "dark"} /><RootNavigator /></>;
}

export default function App() {
  return <SafeAreaProvider><AuthProvider><AppearanceProvider><AppContent /></AppearanceProvider></AuthProvider></SafeAreaProvider>;
}
