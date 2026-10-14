import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const BATCH = 25;

type Outbox = { id: string; recipient_id: string; request_id: string; kind: "request" | "accepted" | "message"; attempts: number; status: string };
type Device = { id: string; expo_push_token: string; platform: string; last_ticket_id: string | null };

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const workerSecret = Deno.env.get("PUSH_WORKER_SECRET");
  const provided = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!workerSecret || workerSecret.length < 32 || !provided || !constantTimeEqual(workerSecret, provided)) {
    return json({ error: "Unauthorized" }, 401);
  }
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) return json({ error: "Push dispatch is not configured." }, 500);
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let receiptCount = 0;
  try { receiptCount = await processReceipts(admin); } catch (error) { console.error("receipt processing failed", safeError(error)); }

  const now = new Date();
  const { data: due = [], error: dueError } = await admin.from("notification_outbox")
    .select("id,recipient_id,request_id,kind,attempts,status")
    .eq("status", "queued").lte("next_attempt_at", now.toISOString()).order("created_at").limit(BATCH);
  if (dueError) return json({ error: "Could not load notification queue." }, 500);
  const { data: expired = [], error: expiredError } = await admin.from("notification_outbox")
    .select("id,recipient_id,request_id,kind,attempts,status")
    .eq("status", "processing").lte("locked_until", now.toISOString()).order("created_at").limit(BATCH);
  if (expiredError) return json({ error: "Could not load notification queue." }, 500);

  let processed = 0;
  for (const candidate of [...due, ...expired] as Outbox[]) {
    const claimed = await claimOutbox(admin, candidate, now);
    if (!claimed) continue;
    processed++;
    try { await processOutbox(admin, claimed); }
    catch (error) {
      const attempts = claimed.attempts + 1;
      const dead = attempts >= 8;
      await admin.from("notification_outbox").update({
        status: dead ? "dead_letter" : "queued",
        attempts,
        next_attempt_at: new Date(Date.now() + retryDelay(attempts)).toISOString(),
        locked_until: null,
        last_error: safeError(error),
      }).eq("id", claimed.id).eq("status", "processing");
    }
  }
  return json({ processed, receiptsChecked: receiptCount }, 200);
});

async function claimOutbox(admin: ReturnType<typeof createClient>, item: Outbox, now: Date): Promise<Outbox | null> {
  const next = { status: "processing", locked_until: new Date(now.getTime() + 90_000).toISOString(), attempts: item.attempts + 1 };
  let query = admin.from("notification_outbox").update(next).eq("id", item.id).eq("status", item.status);
  if (item.status === "queued") query = query.lte("next_attempt_at", now.toISOString());
  else query = query.lte("locked_until", now.toISOString());
  const { data, error } = await query.select("id,recipient_id,request_id,kind,attempts,status").maybeSingle();
  if (error) throw error;
  return data as Outbox | null;
}

async function processOutbox(admin: ReturnType<typeof createClient>, item: Outbox) {
  const [{ data: profile, error: profileError }, { data: preference, error: preferenceError }, { data: request, error: requestError }] = await Promise.all([
    admin.from("profiles").select("account_status").eq("id", item.recipient_id).maybeSingle(),
    admin.from("user_preferences").select("notifications_enabled").eq("user_id", item.recipient_id).maybeSingle(),
    admin.from("connection_requests").select("sender_id,recipient_id,status").eq("id", item.request_id).maybeSingle(),
  ]);
  if (profileError || preferenceError || requestError) throw new Error("Could not validate notification permission.");
  if (profile?.account_status !== "active" || preference?.notifications_enabled !== true || !request) {
    await finishOutbox(admin, item.id, "suppressed");
    return;
  }
  if ((item.kind === "request" && request.status !== "pending") || (item.kind !== "request" && request.status !== "accepted")) {
    await finishOutbox(admin, item.id, "suppressed");
    return;
  }
  const otherUser = request.sender_id === item.recipient_id ? request.recipient_id : request.sender_id;
  const { data: other, error: otherError } = await admin.from("profiles").select("account_status").eq("id", otherUser).maybeSingle();
  if (otherError) throw new Error("Could not validate conversation participants.");
  if (other?.account_status !== "active") { await finishOutbox(admin, item.id, "suppressed"); return; }
  const { data: blockRows, error: blockError } = await admin.from("user_blocks").select("blocked_by")
    .or(`and(blocked_by.eq.${item.recipient_id},blocked_user.eq.${otherUser}),and(blocked_by.eq.${otherUser},blocked_user.eq.${item.recipient_id})`).limit(1);
  if (blockError) throw new Error("Could not validate notification privacy.");
  if (blockRows?.length) { await finishOutbox(admin, item.id, "suppressed"); return; }
  const { data: devices, error: deviceError } = await admin.from("push_devices")
    .select("id,expo_push_token,platform,last_ticket_id").eq("user_id", item.recipient_id).eq("enabled", true).limit(500);
  if (deviceError) throw new Error("Could not load registered devices.");
  if (!devices?.length) { await finishOutbox(admin, item.id, "suppressed"); return; }

  await admin.from("push_deliveries").upsert(devices.map((device) => ({ outbox_id: item.id, device_id: device.id })), {
    onConflict: "outbox_id,device_id", ignoreDuplicates: true,
  });
  const { data: deliveries, error: deliveryError } = await admin.from("push_deliveries")
    .select("id,device_id,attempts,status,locked_until")
    .eq("outbox_id", item.id).in("status", ["queued", "retry"]).limit(500);
  if (deliveryError) throw new Error("Could not load device delivery records.");
  const { data: expiredDeliveries, error: expiredDeliveryError } = await admin.from("push_deliveries")
    .select("id,device_id,attempts,status,locked_until")
    .eq("outbox_id", item.id).eq("status", "processing").lte("locked_until", new Date().toISOString()).limit(500);
  if (expiredDeliveryError) throw new Error("Could not recover device delivery records.");
  const deviceById = new Map((devices as Device[]).map((device) => [device.id, device]));
  const ready = [...(deliveries ?? []), ...(expiredDeliveries ?? [])].filter((delivery) => deviceById.has(delivery.device_id));
  if (!ready.length) { await finishOutbox(admin, item.id, "sent"); return; }

  const expoAccessToken = Deno.env.get("EXPO_ACCESS_TOKEN");
  for (let offset = 0; offset < ready.length; offset += 100) {
    const chunk = ready.slice(offset, offset + 100);
    const sendable: Array<{ id: string; device: Device; attempt: number }> = [];
    for (const delivery of chunk) {
      let claimQuery = admin.from("push_deliveries").update({
        status: "processing", attempts: delivery.attempts + 1, locked_until: new Date(Date.now() + 90_000).toISOString(),
      }).eq("id", delivery.id).eq("status", delivery.status);
      claimQuery = delivery.status === "processing"
        ? claimQuery.lte("locked_until", new Date().toISOString())
        : claimQuery.lte("next_attempt_at", new Date().toISOString());
      const { data: claimed, error } = await claimQuery.select("id").maybeSingle();
      if (error) throw new Error("Could not claim device delivery.");
      if (claimed) sendable.push({ id: delivery.id, device: deviceById.get(delivery.device_id)!, attempt: delivery.attempts + 1 });
    }
    if (!sendable.length) continue;
    const payloads = sendable.map(({ device }) => ({
      to: device.expo_push_token,
      title: item.kind === "request" ? "New connection request" : item.kind === "accepted" ? "Request accepted" : "New message",
      body: item.kind === "request" ? "Someone nearby sent you a connection request." : item.kind === "accepted" ? "Your connection request was accepted." : "You have a new message.",
      sound: "default",
      channelId: "default",
      priority: "default",
      data: { kind: item.kind, requestId: item.request_id },
    }));
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    if (expoAccessToken) headers.Authorization = `Bearer ${expoAccessToken}`;
    const response = await fetch(EXPO_SEND_URL, { method: "POST", headers, body: JSON.stringify(payloads) });
    const body = await response.json().catch(() => null) as { data?: Array<{ status?: string; id?: string; message?: string; details?: { error?: string } }> } | null;
    if (!response.ok || !Array.isArray(body?.data)) throw new Error(`Expo Push service returned HTTP ${response.status}.`);

    for (const [index, ticket] of body.data.entries()) {
      const delivery = sendable[index];
      if (!delivery) continue;
      if (ticket.status === "ok" && ticket.id) {
        await admin.from("push_deliveries").update({ status: "sent", ticket_id: ticket.id, locked_until: null, last_error: null }).eq("id", delivery.id);
        await admin.from("push_devices").update({ last_ticket_id: ticket.id, last_error: null, updated_at: new Date().toISOString() }).eq("id", delivery.device.id);
      } else if (ticket.details?.error === "DeviceNotRegistered") {
        await admin.from("push_deliveries").update({ status: "invalid", locked_until: null, last_error: "DeviceNotRegistered" }).eq("id", delivery.id);
        await admin.from("push_devices").update({ enabled: false, last_error: "DeviceNotRegistered", updated_at: new Date().toISOString() }).eq("id", delivery.device.id);
      } else {
        const exhausted = delivery.attempt >= 8;
        await admin.from("push_deliveries").update({
          status: exhausted ? "suppressed" : "retry", locked_until: null,
          next_attempt_at: new Date(Date.now() + retryDelay(delivery.attempt)).toISOString(),
          last_error: safeError(ticket.message ?? ticket.details?.error ?? "Expo returned a failed ticket"),
        }).eq("id", delivery.id);
      }
    }
  }

  const { data: remaining, error: remainingError } = await admin.from("push_deliveries").select("id")
    .eq("outbox_id", item.id).in("status", ["queued", "processing", "retry"]).limit(1);
  if (remainingError) throw new Error("Could not finalize notification state.");
  if (remaining?.length) {
    await admin.from("notification_outbox").update({ status: "queued", next_attempt_at: new Date(Date.now() + 60_000).toISOString(), locked_until: null })
      .eq("id", item.id).eq("status", "processing");
  } else {
    await finishOutbox(admin, item.id, "sent");
  }
}

async function processReceipts(admin: ReturnType<typeof createClient>): Promise<number> {
  const { data: devices, error } = await admin.from("push_devices").select("id,last_ticket_id")
    .not("last_ticket_id", "is", null).limit(500);
  if (error) throw error;
  const rows = (devices ?? []).filter((row) => typeof row.last_ticket_id === "string");
  let checked = 0;
  for (let offset = 0; offset < rows.length; offset += 300) {
    const chunk = rows.slice(offset, offset + 300);
    const ids = chunk.map((row) => row.last_ticket_id as string);
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    const expoAccessToken = Deno.env.get("EXPO_ACCESS_TOKEN");
    if (expoAccessToken) headers.Authorization = `Bearer ${expoAccessToken}`;
    const response = await fetch(EXPO_RECEIPTS_URL, { method: "POST", headers, body: JSON.stringify({ ids }) });
    if (!response.ok) continue;
    const result = await response.json().catch(() => null) as { data?: Record<string, { status?: string; details?: { error?: string }; message?: string }> } | null;
    for (const device of chunk) {
      const receipt = result?.data?.[device.last_ticket_id as string];
      if (!receipt) continue;
      checked++;
      if (receipt.details?.error === "DeviceNotRegistered") {
        await admin.from("push_devices").update({ enabled: false, last_error: "DeviceNotRegistered", last_ticket_id: null, updated_at: new Date().toISOString() }).eq("id", device.id);
        await admin.from("push_deliveries").update({ status: "invalid", last_error: "DeviceNotRegistered" }).eq("device_id", device.id).eq("ticket_id", device.last_ticket_id);
      } else {
        await admin.from("push_devices").update({ last_error: receipt.status === "error" ? safeError(receipt.message ?? "Push receipt error") : null, last_ticket_id: null, updated_at: new Date().toISOString() }).eq("id", device.id);
      }
    }
  }
  return checked;
}

async function finishOutbox(admin: ReturnType<typeof createClient>, id: string, status: "sent" | "suppressed") {
  await admin.from("notification_outbox").update({ status, sent_at: status === "sent" ? new Date().toISOString() : null, locked_until: null })
    .eq("id", id).eq("status", "processing");
}

function retryDelay(attempt: number) { return Math.min(60 * 60_000, 30_000 * (2 ** Math.max(0, attempt - 1))); }
function safeError(value: unknown) { return String(value instanceof Error ? value.message : value ?? "Unknown error").slice(0, 500); }
function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
