import { ActivityIndicator, View } from "react-native";
import { UpdatePasswordScreen } from "@/screens/auth/UpdatePasswordScreen";
import React, { useMemo } from "react";
import { DarkTheme, DefaultTheme, NavigationContainer, type Theme } from "@react-navigation/native";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/AppearanceContext";
import { AuthNavigator } from "@/navigation/AuthNavigator";
import { AppTabs } from "@/navigation/AppTabs";

export function RootNavigator() {
  const { status, initializing, recovering } = useAuth();
  const { colors, isDark } = useTheme();
  // Feeds the selected theme to navigation containers, headers, tab bars and cards.
  const navTheme = useMemo<Theme>(() => ({
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme : DefaultTheme).colors,
      primary: colors.accent,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      notification: colors.danger,
    },
  }), [colors, isDark]);

  if (initializing) return <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.background }}><ActivityIndicator color={colors.accent} /></View>;
  if (recovering) return <UpdatePasswordScreen />;
  return (
    <NavigationContainer theme={navTheme}>
      {status === "signedIn" ? <AppTabs /> : <AuthNavigator signedInAsUser={status === "onboarding"} />}
    </NavigationContainer>
  );
}
