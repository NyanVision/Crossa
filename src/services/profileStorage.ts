import * as Crypto from "expo-crypto";
import type { CurrentUser, SocialPlatform } from "@/types";
import { requireSupabase } from "@/services/supabase";

const SOCIAL_PLATFORMS: SocialPlatform[] = [
  "facebook", "telegram", "x", "tiktok", "instagram", "line", "whatsapp", "wechat",
];
const AVATAR_BUCKET = "profile-photos";
const SIGNED_URL_SECONDS = 300;

export function emptyProfile(userId: string | null): CurrentUser {
  return {
    id: userId ?? "",
    name: "",
    age: null,
    bio: "",
    photoUri: null,
    photoPath: null,
    links: SOCIAL_PLATFORMS.map((platform) => ({ platform, handle: "", hidden: true })),
    discoveryEnabled: false,
  };
}

export async function signedProfilePhotoUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await requireSupabase().storage.from(AVATAR_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}

export async function loadProfile(userId: string | null): Promise<CurrentUser> {
  if (!userId) return emptyProfile(null);
  const client = requireSupabase();
  const [{ data: row, error: profileError }, { data: linkRows, error: linksError }] = await Promise.all([
    client.from("profiles").select("id,display_name,age,photo_path,bio").eq("id", userId).maybeSingle(),
    client.from("profile_links").select("platform,handle,visible").eq("user_id", userId),
  ]);
  if (profileError) throw profileError;
  if (linksError) throw linksError;
  const photoPath = typeof row?.photo_path === "string" ? row.photo_path : null;
  const links = SOCIAL_PLATFORMS.map((platform) => {
    const saved = (linkRows ?? []).find((link) => link.platform === platform);
    return {
      platform,
      handle: typeof saved?.handle === "string" ? saved.handle : "",
      hidden: saved?.visible !== true,
    };
  });
  return {
    ...emptyProfile(userId),
    id: userId,
    name: typeof row?.display_name === "string" ? row.display_name : "",
    age: typeof row?.age === "number" ? row.age : null,
    bio: typeof row?.bio === "string" ? row.bio : "",
    photoPath,
    photoUri: await signedProfilePhotoUrl(photoPath),
    links,
  };
}

async function uploadProfilePhoto(userId: string, uri: string): Promise<string> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error("The selected photo could not be read.");
  const blob = await response.blob();
  const extension = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
  const path = `${userId}/${Crypto.randomUUID()}.${extension}`;
  const { error } = await requireSupabase().storage.from(AVATAR_BUCKET).upload(path, blob, {
    contentType: blob.type || "image/jpeg",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function saveProfile(profile: CurrentUser): Promise<void> {
  const client = requireSupabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  if (!user || user.id !== profile.id) throw new Error("Sign in again before saving this profile.");

  const oldPhotoPath = profile.photoPath;
  let photoPath = profile.photoUri ? profile.photoPath : null;
  if (profile.photoUri?.startsWith("file://") || profile.photoUri?.startsWith("content://")) {
    photoPath = await uploadProfilePhoto(user.id, profile.photoUri);
  }

  const { error: profileError } = await client.from("profiles").update({
    display_name: profile.name.trim().slice(0, 40),
    age: profile.age,
    bio: profile.bio.trim().slice(0, 120),
    photo_path: photoPath,
    updated_at: new Date().toISOString(),
  }).eq("id", user.id);
  if (profileError) throw profileError;

  const rows = profile.links
    .filter((link) => link.handle.trim().length > 0)
    .map((link) => ({
      user_id: user.id,
      platform: link.platform,
      handle: link.handle.trim().slice(0, 256),
      visible: link.hidden !== true,
      updated_at: new Date().toISOString(),
    }));
  if (rows.length) {
    const { error } = await client.from("profile_links").upsert(rows, { onConflict: "user_id,platform" });
    if (error) throw error;
  }
  const nonEmptyPlatforms = rows.map((row) => row.platform);
  const deleteQuery = client.from("profile_links").delete().eq("user_id", user.id);
  const { error: linkDeleteError } = nonEmptyPlatforms.length
    ? await deleteQuery.not("platform", "in", `(${nonEmptyPlatforms.join(",")})`)
    : await deleteQuery;
  if (linkDeleteError) throw linkDeleteError;

  if (oldPhotoPath && oldPhotoPath !== photoPath) {
    await client.storage.from(AVATAR_BUCKET).remove([oldPhotoPath]).catch(() => undefined);
  }
}
