export function getSupabaseConfigurationError(url: string, key: string): string | null {
  const setup = "Copy .env.example to .env, set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, then restart Expo or rebuild the app.";
  if (!url || !key) return `Supabase settings are missing. ${setup}`;
  if (/YOUR_PROJECT|REPLACE_ME/i.test(url + key)) return `Supabase settings still contain placeholders. ${setup}`;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
      return `Use the HTTPS Supabase project URL, without an API path. ${setup}`;
    }
  } catch {
    return `The Supabase project URL is invalid. ${setup}`;
  }
  if (!key.startsWith("sb_publishable_") || key.length <= "sb_publishable_".length) {
    return `Use a Supabase publishable key (sb_publishable_…), never a secret or service-role key. ${setup}`;
  }
  return null;
}
