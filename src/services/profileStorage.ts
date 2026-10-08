import { File } from 'expo-file-system';
import { supabase } from '@/lib/supabase';
import type { CurrentUser, SocialPlatform } from '@/types';

const SOCIAL_PLATFORMS: SocialPlatform[] = ['facebook', 'telegram', 'x', 'tiktok', 'instagram', 'line', 'whatsapp', 'wechat'];
export function emptyProfile(userId: string | null): CurrentUser {
  return { id: userId ?? '', name: '', bio: '', photoUri: null,
    links: SOCIAL_PLATFORMS.map(platform => ({ platform, handle: '', hidden: true })), discoveryEnabled: false };
}

export async function loadProfile(userId: string | null): Promise<CurrentUser> {
  if (!userId) return emptyProfile(null);
  const { data, error } = await supabase.from('profiles').select('display_name,bio,avatar_path,social_links').eq('id', userId).maybeSingle();
  if (error) throw error;
  if (!data) return emptyProfile(userId);
  let photoUri: string | null = null;
  if (data.avatar_path) {
    const signed = await supabase.storage.from('avatars').createSignedUrl(data.avatar_path, 3600);
    if (signed.error) throw signed.error;
    photoUri = signed.data.signedUrl;
  }
  return { ...emptyProfile(userId), name: data.display_name, bio: data.bio, photoUri,
    links: SOCIAL_PLATFORMS.map(platform => {
      const link = (data.social_links as CurrentUser['links']).find(item => item.platform === platform);
      return { platform, handle: link?.handle ?? '', hidden: link?.hidden !== false };
    }) };
}

export async function saveProfile(profile: CurrentUser): Promise<void> {
  if (!profile.id) throw new Error('Sign in to save your profile.');
  const name = profile.name.trim();
  if (!name || name.length > 40 || profile.bio.trim().length > 120) throw new Error('Use a name of 1–40 characters and a bio of up to 120 characters.');
  const existing = await supabase.from('profiles').select('avatar_path').eq('id', profile.id).maybeSingle();
  if (existing.error) throw existing.error;
  if (!existing.data) {
    const created = await supabase.from('profiles').upsert({ id: profile.id }, { onConflict: 'id', ignoreDuplicates: true });
    if (created.error) throw created.error;
  }
  let avatarPath: string | null = existing.data?.avatar_path ?? null;
  const oldPath = avatarPath;
  let uploaded = false;
  if (!profile.photoUri) avatarPath = null;
  else if (!profile.photoUri.startsWith('https://')) {
    const bytes = profile.photoUri.startsWith('blob:') || profile.photoUri.startsWith('data:')
      ? await (await fetch(profile.photoUri)).arrayBuffer()
      : await new File(profile.photoUri).arrayBuffer();
    if (bytes.byteLength > 5 * 1024 * 1024) throw new Error('Choose a photo smaller than 5 MB.');
    const head = new Uint8Array(bytes);
    const png = head[0] === 137 && head[1] === 80 && head[2] === 78 && head[3] === 71;
    const jpeg = head[0] === 255 && head[1] === 216;
    if (!png && !jpeg) throw new Error('Choose a JPEG or PNG photo.');
    avatarPath = `${profile.id}/${Date.now()}.${png ? 'png' : 'jpg'}`;
    const upload = await supabase.storage.from('avatars').upload(avatarPath, bytes, { contentType: png ? 'image/png' : 'image/jpeg' });
    if (upload.error) throw upload.error;
    uploaded = true;
  }
  const links = SOCIAL_PLATFORMS.map(platform => {
    const entry = profile.links.find(link => link.platform === platform);
    const handle = entry?.handle.trim() ?? '';
    return { platform, handle, hidden: !handle || entry?.hidden !== false };
  });
  const { error } = await supabase.from('profiles').upsert({ id: profile.id, display_name: name,
    bio: profile.bio.trim(), avatar_path: avatarPath, social_links: links });
  if (error) {
    if (uploaded && avatarPath) await supabase.storage.from('avatars').remove([avatarPath]);
    throw error;
  }
  if (oldPath && oldPath !== avatarPath) await supabase.storage.from('avatars').remove([oldPath]);
}
