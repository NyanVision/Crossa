import type { NearbyProfile } from "@/services/discovery";
import { requireSupabase } from "@/services/supabase";
import { signedProfilePhotoUrl } from "@/services/profileStorage";

export async function getProfileQrPayload(): Promise<string> {
  const { data, error } = await requireSupabase().rpc("my_profile_qr_token");
  if (error) throw error;
  if (typeof data !== "string") throw new Error("No QR token was returned.");
  return `catchya://profile/${data}`;
}

export function getProfileCodeFromQr(value: string): string | null {
  const match = value.trim().match(/^catchya:\/\/profile\/([0-9a-f-]{36})$/i);
  return match?.[1] ?? null;
}

export async function resolveProfileQr(value: string): Promise<NearbyProfile | null> {
  const token = getProfileCodeFromQr(value);
  if (!token) return null;
  const { data, error } = await requireSupabase().rpc("resolve_profile_qr", { p_token: token });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return null;
  return {
    id: row.profile_id,
    displayName: row.display_name,
    age: typeof row.age === "number" ? row.age : null,
    photoUrl: await signedProfilePhotoUrl(row.photo_path),
    distanceRange: row.distance_range ?? "Found by QR",
    contactLinks: Array.isArray(row.social_links) ? row.social_links : [],
    genderLabel: row.gender_label ?? null,
    interests: Array.isArray(row.interests) ? row.interests : [],
    discoverable: false,
    audienceMatch: true,
  };
}
