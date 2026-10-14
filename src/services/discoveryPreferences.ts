import { requireSupabase } from "@/services/supabase";

export type VisibilityDuration = "15 minutes" | "30 minutes" | "1 hour";

export interface DiscoveryPreferences {
  enabled: boolean;
  duration: VisibilityDuration;
  expiresAt: number | null;
}

export interface DiscoveryLocation {
  latitude: number;
  longitude: number;
}

const DURATIONS: VisibilityDuration[] = ["15 minutes", "30 minutes", "1 hour"];

export function defaultDiscoveryPreferences(): DiscoveryPreferences {
  return { enabled: false, duration: "15 minutes", expiresAt: null };
}

function fromRow(row: { enabled?: unknown; duration?: unknown; expires_at?: unknown } | null | undefined): DiscoveryPreferences {
  const duration = DURATIONS.includes(row?.duration as VisibilityDuration)
    ? row?.duration as VisibilityDuration
    : "15 minutes";
  const expiresAt = typeof row?.expires_at === "string" ? Date.parse(row.expires_at) : null;
  const expired = row?.enabled === true && expiresAt !== null && expiresAt <= Date.now();
  return {
    enabled: row?.enabled === true && !expired,
    duration,
    expiresAt: row?.enabled === true && !expired ? expiresAt : null,
  };
}

export async function loadDiscoveryPreferences(_userId: string | null): Promise<DiscoveryPreferences> {
  const { data, error } = await requireSupabase().rpc("my_discovery_preferences");
  if (error) throw error;
  return fromRow(Array.isArray(data) ? data[0] : data);
}

export async function saveDiscoveryPreferences(
  _userId: string | null,
  enabled: boolean,
  duration: VisibilityDuration,
  location?: DiscoveryLocation,
): Promise<DiscoveryPreferences> {
  if (enabled && !location) throw new Error("Foreground location is required to turn on nearby discovery.");
  const { data, error } = await requireSupabase().rpc("set_my_discovery", {
    p_enabled: enabled,
    p_duration: duration,
    p_latitude: location?.latitude ?? null,
    p_longitude: location?.longitude ?? null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return fromRow(row);
}
