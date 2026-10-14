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
  if (!url || !anonKey || !serviceRoleKey) return json({ error: "Account deletion is not configured." }, 500);

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: "Invalid or expired session." }, 401);

  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  // Profile photos are in the user's own object prefix. Remove these before deleting
  // auth.users so the database cascade and Storage cleanup both complete.
  const { data: objects, error: listError } = await admin.storage.from("profile-photos").list(user.id, { limit: 1000 });
  if (listError) return json({ error: "Could not clean up profile photos. No account data was deleted." }, 500);
  if (objects?.length) {
    const paths = objects.filter((file) => file.name && !file.id?.endsWith("/"))
      .map((file) => `${user.id}/${file.name}`);
    if (paths.length) {
      const { error: removeError } = await admin.storage.from("profile-photos").remove(paths);
      if (removeError) return json({ error: "Could not clean up profile photos. No account data was deleted." }, 500);
    }
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) return json({ error: "Account deletion failed. Please try again." }, 500);
  return json({ deleted: true }, 200);
});

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
