import type { AppearanceChoice } from "@/context/AppearanceContext";
import { requireSupabase } from "@/services/supabase";

export interface UserSettings {
  appearance: AppearanceChoice;
  notificationsEnabled: boolean;
}

export function defaultUserSettings(): UserSettings {
  return { appearance: "system", notificationsEnabled: false };
}

export async function loadUserSettings(userId: string | null): Promise<UserSettings> {
  if (!userId) return defaultUserSettings();
  const { data, error } = await requireSupabase().from("user_preferences")
    .select("appearance,notifications_enabled").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  const appearance = data?.appearance === "light" || data?.appearance === "dark" ? data.appearance : "system";
  return { appearance, notificationsEnabled: data?.notifications_enabled === true };
}

export async function saveUserSettings(userId: string | null, patch: Partial<UserSettings>): Promise<void> {
  if (!userId) throw new Error("Sign in before saving these preferences.");
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.appearance !== undefined) update.appearance = patch.appearance;
  if (patch.notificationsEnabled !== undefined) update.notifications_enabled = patch.notificationsEnabled;
  const { data, error } = await requireSupabase().from("user_preferences").update(update)
    .eq("user_id", userId).select("user_id").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Could not save these account preferences.");
}
