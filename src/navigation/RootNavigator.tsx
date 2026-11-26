import React, { useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Notifications from "expo-notifications";
import { createNavigationContainerRef, DarkTheme, DefaultTheme, NavigationContainer, type Theme } from "@react-navigation/native";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/AppearanceContext";
import { AuthNavigator } from "@/navigation/AuthNavigator";
import { AppTabs, type AppTabParamList } from "@/navigation/AppTabs";
import { setActivePushUser, synchronizePushToken, watchPushTokenRotation } from "@/services/notifications";
import { notificationRequestId } from "@/services/notificationLinks";
import { loadInbox } from "@/services/inbox";
import { InboxProvider } from "@/context/InboxContext";
import { ReportProvider } from "@/context/ReportContext";

const navigationRef = createNavigationContainerRef<AppTabParamList>();

export function RootNavigator() {
  const { status, userId } = useAuth();
  const { colors, isDark } = useTheme();
  const [navigationReady, setNavigationReady] = useState(false);
  const [response, setResponse] = useState<Notifications.NotificationResponse | null>(null);
  const handled = useRef(new Set<string>());

  useEffect(() => {
    setActivePushUser(status === "signedIn" ? userId : null);
    return () => setActivePushUser(null);
  }, [status, userId]);

  useEffect(() => {
    if (status !== "signedIn" || !userId) return;
    const sync = () => { void synchronizePushToken(userId).catch(() => undefined); };
    sync();
    const rotation = watchPushTokenRotation(userId);
    const foreground = AppState.addEventListener("change", (state) => { if (state === "active") sync(); });
    return () => { rotation.remove(); foreground.remove(); };
  }, [status, userId]);

  useEffect(() => {
    let active = true;
    const listener = Notifications.addNotificationResponseReceivedListener(setResponse);
    void Notifications.getLastNotificationResponseAsync().then((last) => {
      if (active && last) setResponse((current) => current ?? last);
    }).catch(() => undefined);
    return () => { active = false; listener.remove(); };
  }, []);

  useEffect(() => {
    if (!response || !navigationReady || status !== "signedIn" || !userId) return;
    const identifier = response.notification.request.identifier;
    const clear = () => {
      setResponse((current) => current?.notification.request.identifier === identifier ? null : current);
      void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
    };
    if (handled.current.has(identifier)) { clear(); return; }
    const requestId = notificationRequestId(response.notification.request.content.data, userId);
    if (!requestId) { clear(); return; }
    let active = true;
    const route = async () => {
      // Resolve with the signed-in account rather than trusting a stale push's
      // request/accepted state. RLS still protects all conversation reads.
      const inbox = await loadInbox().catch(() => []);
      if (!active || !navigationRef.isReady()) return;
      const item = inbox.find((conversation) => conversation.id === requestId);
      if (item?.status === "request") navigationRef.navigate("MessagesTab", { screen: "MessageRequestDetail", params: { requestId } });
      else if (item?.status === "chat") navigationRef.navigate("MessagesTab", { screen: "Chat", params: { chatId: requestId } });
      else navigationRef.navigate("MessagesTab", { screen: "Messages" });
      handled.current.add(identifier);
      if (handled.current.size > 20) handled.current.delete(handled.current.values().next().value!);
      clear();
    };
    void route();
    return () => { active = false; };
  }, [response, navigationReady, status, userId]);
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
    <NavigationContainer theme={navTheme} ref={navigationRef} onReady={() => setNavigationReady(true)}>
      {status === "signedIn" ? <InboxProvider key={userId}><ReportProvider><AppTabs /></ReportProvider></InboxProvider> : <AuthNavigator signedInAsUser={status === "onboarding"} recovering={status === "recovering"} />}
    </NavigationContainer>
  );
}

