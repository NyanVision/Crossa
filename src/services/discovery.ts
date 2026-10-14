import type { PublicProfile, PublicContactLink } from "@/types";
import type { MeetingOption } from "@/services/aboutYouPreferences";
import type { DiscoveryLocation } from "@/services/discoveryPreferences";
import { requireSupabase } from "@/services/supabase";
import { signedProfilePhotoUrl } from "@/services/profileStorage";

export type DistanceRange = "Within 1 km" | "1–3 km" | "3–5 km" | "5+ km";

export interface NearbyProfile extends PublicProfile {
  distanceRange: DistanceRange;
  interests: string[];
  discoverable: boolean;
  /** Mutual audience filtering has already been applied by the database RPC. */
  audienceMatch: true;
}

interface NearbyProfileRow {
  profile_id: string;
  display_name: string;
  age: number | null;
  photo_path: string | null;
  bio: string;
  gender_label: string | null;
  social_links: PublicContactLink[] | null;
  distance_range: DistanceRange;
  interests: string[] | null;
}

export async function loadNearbyProfiles(location: DiscoveryLocation): Promise<NearbyProfile[]> {
  const { data, error } = await requireSupabase().rpc("nearby_profiles", {
    p_latitude: location.latitude,
    p_longitude: location.longitude,
    p_radius_m: 10000,
  });
  if (error) throw error;
  const rows = (data ?? []) as NearbyProfileRow[];
  return Promise.all(rows.map(async (row) => ({
    id: row.profile_id,
    displayName: row.display_name,
    age: typeof row.age === "number" ? row.age : null,
    photoUrl: await signedProfilePhotoUrl(row.photo_path),
    distanceRange: row.distance_range,
    contactLinks: Array.isArray(row.social_links) ? row.social_links : [],
    genderLabel: row.gender_label,
    bio: row.bio ?? "",
    interests: Array.isArray(row.interests) ? row.interests : [],
    discoverable: true,
    audienceMatch: true,
  })));
}

export function getDiscoverableProfiles(profiles: NearbyProfile[]) {
  return profiles.filter((profile) => profile.discoverable);
}

/** Kept for existing screen callers; the RPC already performs mutual private filtering. */
export function filterProfilesByAudience(profiles: NearbyProfile[], _preferences: MeetingOption[]) {
  return profiles.filter((profile) => profile.audienceMatch);
}
