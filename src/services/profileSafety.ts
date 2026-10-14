import { requireSupabase } from "@/services/supabase";

export interface BlockedProfile {
  profileId: string;
  displayName: string;
}

export async function isProfileBlocked(profileId: string): Promise<boolean> {
  return (await loadBlockedProfiles()).some((profile) => profile.profileId === profileId);
}

export async function loadBlockedProfiles(): Promise<BlockedProfile[]> {
  const { data, error } = await requireSupabase().rpc("my_blocked_profiles");
  if (error) throw error;
  return (data ?? []).map((row: { profile_id: string; display_name: string }) => ({
    profileId: row.profile_id,
    displayName: row.display_name || "Blocked account",
  }));
}

export async function setProfileBlocked(profileId: string, blocked: boolean, _displayName?: string): Promise<void> {
  const { data, error } = await requireSupabase().rpc("set_profile_blocked", {
    p_profile_id: profileId,
    p_blocked: blocked,
  });
  if (error) throw error;
  if (data !== true) throw new Error("Could not update the block.");
}

export async function recordProfileReport(profileId: string, reason = "profile"): Promise<void> {
  const { error } = await requireSupabase().rpc("report_profile", {
    p_profile_id: profileId,
    p_reason: reason,
  });
  if (error) throw error;
}
