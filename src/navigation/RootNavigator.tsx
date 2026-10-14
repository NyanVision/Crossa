import React, { useEffect, useMemo, useRef, useState } from "react";
import { DarkTheme, DefaultTheme, NavigationContainer, type Theme } from "@react-navigation/native";
import * as Notifications from "expo-notifications";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/AppearanceContext";
import { AuthNavigator } from "@/navigation/AuthNavigator";
import { AppTabs, appNavigationRef } from "@/navigation/AppTabs";
import { watchPushTokenRotation } from "@/services/notifications";

export function RootNavigator() {
  const { status, onboardingStep, recoveryMode } = useAuth();
  const { colors, isDark } = useTheme();
  const pendingNotification = useRef<Notifications.NotificationResponse | null>(null);
  const routedNotificationId = useRef<string | null>(null);
  const [navigationReady, setNavigationReady] = useState(false);

  const routeNotification = (response: Notifications.NotificationResponse) => {
    if (status !== "signedIn" || !navigationReady || !appNavigationRef.isReady()) {
      pendingNotification.current = response;
      return;
    }
    const responseId = response.notification.request.identifier;
    if (routedNotificationId.current === responseId) return;
    const data = response.notification.request.content.data as { kind?: string; requestId?: string };
    if (!data.requestId) return;
    routedNotificationId.current = responseId;
    if (data.kind === "request") {
      appNavigationRef.navigate("MessagesTab", { screen: "MessageRequestDetail", params: { requestId: data.requestId } });
    } else if (data.kind === "accepted" || data.kind === "message") {
      appNavigationRef.navigate("MessagesTab", { screen: "Chat", params: { chatId: data.requestId } });
    }
  };

  useEffect(() => {
    let alive = true;
    const tokenSubscription = watchPushTokenRotation();
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (alive && response) routeNotification(response);
    });
    const subscription = Notifications.addNotificationResponseReceivedListener(routeNotification);
    return () => { alive = false; subscription.remove(); tokenSubscription.remove(); };
  }, [navigationReady, status]);

  useEffect(() => {
    if (status === "signedIn" && pendingNotification.current) {
      const response = pendingNotification.current;
      pendingNotification.current = null;
      routeNotification(response);
    }
  }, [navigationReady, status]);
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

  return (
    <NavigationContainer ref={appNavigationRef} theme={navTheme} onReady={() => setNavigationReady(true)}>
      {status === "signedIn" ? <AppTabs /> : <AuthNavigator signedInAsUser={status === "onboarding"} onboardingStep={onboardingStep} recoveryMode={recoveryMode || status === "recovering"} />}
    </NavigationContainer>
  );
}
