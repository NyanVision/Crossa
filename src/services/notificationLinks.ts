export function notificationRequestId(data: unknown, userId: string): string | null {
  if (!data || typeof data !== "object") return null;
  const payload = data as Record<string, unknown>;
  if (payload.recipientId !== userId || !["request", "accepted", "message"].includes(String(payload.kind))) return null;
  return typeof payload.requestId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.requestId)
    ? payload.requestId : null;
}
