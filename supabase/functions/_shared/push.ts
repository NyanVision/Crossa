export type PushKind = "request" | "accepted" | "message";
export type ExpoResult = { status?: string; id?: string; details?: { error?: string } };
export type PushOutcome = "retry" | "ticketed" | "delivered" | "invalid" | "failed" | "unknown";

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** The caller must verify the JWT before using this non-verifying decoder. */
export function sessionIdFromVerifiedJwt(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
    const claims = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
    return isUuid(claims.session_id) ? claims.session_id : null;
  } catch { return null; }
}

export function constantTimeEqual(expected: string, provided: string): boolean {
  let difference = expected.length ^ provided.length;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ (provided.charCodeAt(i) || 0);
  return difference === 0;
}

/** Supports existing environment credentials and a Vault-backed scheduled worker. */
export async function authorizePushWorker(provided: string, expected: string | undefined, verifyVault: (secret: string) => Promise<boolean>): Promise<boolean> {
  if (provided.length < 32 || provided.length > 256) return false;
  if (expected && expected.length >= 32 && constantTimeEqual(expected, provided)) return true;
  return verifyVault(provided);
}

export function expoOutcome(result: ExpoResult | null | undefined, receipt = false, receiptExpired = false): PushOutcome {
  if (result?.details?.error === "DeviceNotRegistered") return "invalid";
  if (result?.details?.error === "MessageTooBig" || result?.details?.error === "InvalidCredentials") return "failed";
  if (result?.status === "ok") return receipt ? "delivered" : typeof result.id === "string" && result.id ? "ticketed" : "retry";
  if (receipt && (!result || result.status !== "error")) return receiptExpired ? "unknown" : "ticketed";
  return "retry";
}

export function pushPayload(item: { token: string; recipient_id: string; request_id: string; kind: PushKind }) {
  return {
    to: item.token,
    title: item.kind === "request" ? "New connection request" : item.kind === "accepted" ? "Request accepted" : "New message",
    body: item.kind === "request" ? "You have a new connection request." : item.kind === "accepted" ? "Your connection request was accepted." : "You have a new message.",
    sound: "default", channelId: "default", priority: "default",
    // No names, message text, or location in lock-screen payloads.
    data: { kind: item.kind, requestId: item.request_id, recipientId: item.recipient_id },
  };
}
