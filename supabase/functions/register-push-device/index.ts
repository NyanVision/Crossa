import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { isUuid, sessionIdFromVerifiedJwt } from "../_shared/push.ts";

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

  try {
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Invalid or expired session." }, 401);
    // Decode only AFTER getUser verifies this exact JWT with the Auth server.
    const sessionId = sessionIdFromVerifiedJwt(authorization.slice(7));
    if (!sessionId) return json({ error: "A valid device session is required." }, 401);

    let body: { action?: string; userId?: string; installationId?: string; token?: string; platform?: string };
    try { body = await request.json(); } catch { return json({ error: "Invalid request body." }, 400); }
    if (!body || body.userId !== user.id) return json({ error: "The signed-in account changed. Please try again." }, 409);
    if (!isUuid(body.installationId)) return json({ error: "A valid installation ID is required." }, 400);
    const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    if (body.action === "unregister") {
      const { error } = await admin.from("push_devices").delete()
        .eq("user_id", user.id).eq("installation_id", body.installationId);
      if (error) return json({ error: "Could not remove this device registration." }, 500);
      return json({ registered: false }, 200);
    }
    if (body.action !== "register") return json({ error: "Unsupported action." }, 400);
    if (typeof body.token !== "string" || body.token.length > 256 || !/^(Expo|Exponent)PushToken\[[A-Za-z0-9_:-]+\]$/.test(body.token)) {
      return json({ error: "Invalid Expo push token." }, 400);
    }
    if (body.platform !== "ios" && body.platform !== "android") return json({ error: "Unsupported platform." }, 400);
    const { error } = await admin.rpc("register_push_device", {
      p_user_id: user.id, p_session_id: sessionId, p_installation_id: body.installationId,
      p_token: body.token, p_platform: body.platform,
    });
    if (error) return json({ error: "Could not register this device. Sign in again and retry." }, 409);
    return json({ registered: true }, 200);
  } catch {
    return json({ error: "Push registration is temporarily unavailable." }, 503);
  }
});

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
