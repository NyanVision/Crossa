import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { authorizePushWorker, expoOutcome, pushPayload, type ExpoResult, type PushKind } from "../_shared/push.ts";

const EXPO_API = "https://exp.host/--/api/v2/push/";
type Claim = { id: string; lease_token: string; token: string; recipient_id: string; request_id: string; kind: PushKind; attempts: number };
type Receipt = { id: string; lease_token: string; ticket_id: string; ticket_at: string };
type Admin = SupabaseClient;

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const expected = Deno.env.get("PUSH_WORKER_SECRET");
  const provided = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (provided.length < 32 || provided.length > 256) return json({ error: "Unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "Push dispatch is not configured." }, 500);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const authorized = await authorizePushWorker(provided, expected, async (secret) => {
    const { data, error } = await admin.rpc("verify_crossa_push_secret", { p_secret: secret });
    return !error && data === true;
  }).catch(() => false);
  if (!authorized) return json({ error: "Unauthorized" }, 401);
  try {
    const receiptsChecked = await processReceipts(admin);
    const { data, error } = await admin.rpc("claim_push_deliveries", { p_limit: 25 });
    if (error) throw error;
    const claims = (data ?? []) as Claim[];
    const sendable: Claim[] = [];
    for (const item of claims) {
      const { data: allowed, error: allowedError } = await admin.rpc("push_delivery_still_allowed", { p_id: item.id, p_lease: item.lease_token });
      if (allowedError) throw allowedError;
      if (allowed === true) sendable.push(item);
      else await finish(admin, item, "suppressed");
    }
    if (sendable.length) {
      let tickets: ExpoResult[] = [];
      let transportError: string | null = null;
      try {
        const response = await expoRequest("send", sendable.map(pushPayload));
        if (!Array.isArray(response.data)) throw new Error("Invalid Expo ticket response");
        tickets = response.data as ExpoResult[];
      } catch { transportError = "Expo transport unavailable"; }
      await Promise.all(sendable.map(async (item, index) => {
        const ticket = tickets[index];
        const outcome = expoOutcome(ticket);
        await finish(admin, item, outcome, outcome === "ticketed" ? ticket.id : undefined,
          transportError ?? (outcome === "ticketed" ? null : ticket?.details?.error ?? "Invalid or missing Expo ticket"));
      }));
    }
    return json({ processed: claims.length, submitted: sendable.length, receiptsChecked }, 200);
  } catch {
    // Claims have bounded leases and will be recovered by a later scheduled run.
    // Never log JWTs, device tokens, or provider responses.
    return json({ error: "Push dispatch failed. The queue will retry." }, 503);
  }
});

async function processReceipts(admin: Admin): Promise<number> {
  const { data, error } = await admin.rpc("claim_push_receipts", { p_limit: 100 });
  if (error) throw error;
  const claims = (data ?? []) as Receipt[];
  if (!claims.length) return 0;
  let receipts: Record<string, ExpoResult> = {};
  try {
    const response = await expoRequest("getReceipts", { ids: claims.map((item) => item.ticket_id) });
    if (typeof response.data === "object" && response.data && !Array.isArray(response.data)) receipts = response.data as Record<string, ExpoResult>;
  } catch { /* Preserve ticket IDs and check again in fifteen minutes. */ }
  await Promise.all(claims.map(async (item) => {
    const expired = Date.now() - new Date(item.ticket_at).getTime() >= 24 * 60 * 60_000;
    const receipt = receipts[item.ticket_id];
    const outcome = expoOutcome(receipt, true, expired);
    await finish(admin, item, outcome, outcome === "ticketed" ? item.ticket_id : undefined,
      outcome === "delivered" || outcome === "ticketed" ? null : receipt?.details?.error ?? "Receipt unavailable");
  }));
  return claims.length;
}

async function expoRequest(path: string, body: unknown): Promise<{ data?: unknown }> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  const token = Deno.env.get("EXPO_ACCESS_TOKEN");
  if (token) headers.Authorization = "Bearer " + token;
  const response = await fetch(EXPO_API + path, {
    method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Expo request failed");
  return await response.json();
}

async function finish(admin: Admin, item: { id: string; lease_token: string }, status: string, ticket?: string, error?: string | null) {
  const { error: saveError } = await admin.rpc("finish_push_delivery", {
    p_id: item.id, p_lease: item.lease_token, p_status: status, p_ticket: ticket ?? null, p_error: error ?? null,
  });
  if (saveError) throw saveError;
}

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
