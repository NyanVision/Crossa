import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import * as Crypto from "expo-crypto";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { supabase, requireSupabase } from "@/services/supabase";
import { notificationRequestId } from "@/services/notificationLinks";

let activePushUser: string | null = null;
export function setActivePushUser(userId: string | null) { activePushUser = userId; }

Notifications.setNotificationHandler({
  handleNotification: async (notification) => ({
    shouldShowBanner: !!activePushUser && !!notificationRequestId(notification.request.content.data, activePushUser),
    shouldShowList: !!activePushUser && !!notificationRequestId(notification.request.content.data, activePushUser),
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const installationKey = "catchya:pushInstallationId";
const registrationPrefix = "catchya:pushRegistered:";
let installationPromise: Promise<string> | null = null;

function registrationKey(userId: string) { return `${registrationPrefix}${userId}`; }

async function getInstallationId() {
  if (!installationPromise) {
    const pending = (async () => {
      const saved = await AsyncStorage.getItem(installationKey);
      if (saved) return saved;
      const created = Crypto.randomUUID();
      await AsyncStorage.setItem(installationKey, created);
      return created;
    })();
    installationPromise = pending.catch((error) => {
      installationPromise = null;
      throw error;
    });
  }
  return installationPromise;
}

function getEasProjectId() {
  return Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId ?? undefined;
}

/** Requests foreground notification permission and registers the resulting Expo token on the user's account. */
export async function registerForPushNotifications(userId: string, requestPermission = true): Promise<string | null> {
  if (!Device.isDevice || (Platform.OS !== "ios" && Platform.OS !== "android")) return null;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default", importance: Notifications.AndroidImportance.DEFAULT, lightColor: "#496C89",
    });
  }
  const permission = await Notifications.getPermissionsAsync();
  const finalStatus = permission.status === "granted" || !requestPermission ? permission.status : (await Notifications.requestPermissionsAsync()).status;
  if (finalStatus !== "granted") return null;
  const projectId = getEasProjectId();
  if (!projectId) throw new Error("Set an EAS project ID in app.json before registering push notifications.");
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await saveTokenOnServer(token, userId);
  return token;
}

async function saveTokenOnServer(token: string, userId: string) {
  const client = requireSupabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  if (!user || user.id !== userId) throw new Error("Sign in again before enabling notifications.");
  const { error } = await client.functions.invoke("register-push-device", {
    body: {
      action: "register",
      userId,
      installationId: await getInstallationId(),
      token,
      platform: Platform.OS === "ios" ? "ios" : "android",
    },
  });
  if (error) throw error;
  await AsyncStorage.setItem(registrationKey(user.id), "true");
}

export async function unregisterPushDevice(): Promise<void> {
  if (!supabase) return;
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!user) return;
  const key = registrationKey(user.id);
  const installationId = await AsyncStorage.getItem(installationKey);
  if (!installationId) return;
  const { error } = await supabase.functions.invoke("register-push-device", {
    body: { action: "unregister", installationId, userId: user.id },
  });
  if (error) throw error;
  await AsyncStorage.removeItem(key);
}

/** One root listener refreshes rotated tokens without asking for permission again. */
export function watchPushTokenRotation(userId: string) {
  return Notifications.addPushTokenListener(() => {
    void synchronizePushToken(userId).catch(() => undefined);
  });
}

const synchronizations = new Map<string, Promise<void>>();
export function synchronizePushToken(userId: string): Promise<void> {
  const existing = synchronizations.get(userId);
  if (existing) return existing;
  const pending = synchronize(userId).finally(() => { synchronizations.delete(userId); });
  synchronizations.set(userId, pending);
  return pending;
}

async function synchronize(userId: string) {
  if (!supabase || !Device.isDevice || (Platform.OS !== "ios" && Platform.OS !== "android")) return;
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user || user.id !== userId) return;
  const { data: settings, error } = await supabase.from("user_preferences")
    .select("notifications_enabled").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (settings?.notifications_enabled !== true) return;
  const token = await registerForPushNotifications(userId, false);
  if (!token) await unregisterPushDevice();
}
