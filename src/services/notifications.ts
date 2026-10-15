import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import * as Crypto from "expo-crypto";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { supabase, requireSupabase } from "@/services/supabase";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
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
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice || (Platform.OS !== "ios" && Platform.OS !== "android")) return null;
  const permission = await Notifications.getPermissionsAsync();
  const finalStatus = permission.status === "granted" ? "granted" : (await Notifications.requestPermissionsAsync()).status;
  if (finalStatus !== "granted") return null;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default", importance: Notifications.AndroidImportance.DEFAULT, lightColor: "#496C89",
    });
  }
  const projectId = getEasProjectId();
  if (!projectId) throw new Error("Set an EAS project ID in app.json before registering push notifications.");
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await saveTokenOnServer(token);
  return token;
}

async function saveTokenOnServer(token: string) {
  const client = requireSupabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  if (!user) throw new Error("Sign in before registering this device.");
  const { error } = await client.functions.invoke("register-push-device", {
    body: {
      action: "register",
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
  if (await AsyncStorage.getItem(key) !== "true") return;
  const { error } = await supabase.functions.invoke("register-push-device", {
    body: { action: "unregister", installationId: await getInstallationId() },
  });
  if (error) throw error;
  await AsyncStorage.removeItem(key);
}

export async function hasPushRegistrationForCurrentUser(): Promise<boolean> {
  if (!supabase) return false;
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  return user ? (await AsyncStorage.getItem(registrationKey(user.id))) === "true" : false;
}

export async function forgetPushRegistrationForUser(userId: string): Promise<void> {
  await AsyncStorage.removeItem(registrationKey(userId));
}

/** Call once from the app root; token rotations are saved only when account notifications are enabled. */
export function watchPushTokenRotation() {
  return Notifications.addPushTokenListener(() => {
    void synchronizePushToken().catch(() => undefined);
  });
}

async function synchronizePushToken() {
  if (!supabase || !Device.isDevice || (Platform.OS !== "ios" && Platform.OS !== "android")) return;
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return;
  const { data: settings, error } = await supabase.from("user_preferences")
    .select("notifications_enabled").eq("user_id", user.id).maybeSingle();
  if (error || settings?.notifications_enabled !== true) return;
  const permission = await Notifications.getPermissionsAsync();
  if (permission.status !== "granted") return;
  const projectId = getEasProjectId();
  if (!projectId) return;
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await saveTokenOnServer(token);
}
