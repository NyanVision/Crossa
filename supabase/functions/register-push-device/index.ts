import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRoleKey) return json({ error: "Push registration is not configured." }, 500);

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: "Invalid or expired session." }, 401);

  let body: { action?: string; installationId?: string; token?: string; platform?: string };
  try { body = await request.json(); } catch { return json({ error: "Invalid request body." }, 400); }
  if (!isUuid(body.installationId)) return json({ error: "A valid installation ID is required." }, 400);
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  if (body.action === "unregister") {
    const { error } = await admin.from("push_devices").delete()
      .eq("user_id", user.id).eq("installation_id", body.installationId);
    if (error) return json({ error: "Could not remove this device registration." }, 500);
    return json({ registered: false }, 200);
  }

  if (body.action !== "register") return json({ error: "Unsupported action." }, 400);
  if (typeof body.token !== "string" || !/^(Expo|Exponent)PushToken\[[A-Za-z0-9_:-]+\]$/.test(body.token)) {
    return json({ error: "Invalid Expo push token." }, 400);
  }
  if (body.platform !== "ios" && body.platform !== "android") return json({ error: "Unsupported platform." }, 400);

  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("account_status").eq("id", user.id).maybeSingle();
  if (profileError) return json({ error: "Could not verify account status." }, 500);
  if (profile?.account_status !== "active") return json({ error: "Only active accounts may register devices." }, 403);

  const { error: saveError } = await admin.from("push_devices").upsert({
    user_id: user.id,
    installation_id: body.installationId,
    expo_push_token: body.token,
    platform: body.platform,
    enabled: true,
    last_seen_at: new Date().toISOString(),
    last_error: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,installation_id" });
  if (saveError) return json({ error: "Could not save this device. Check whether its token is registered to another account." }, 409);
  return json({ registered: true }, 200);
});

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
