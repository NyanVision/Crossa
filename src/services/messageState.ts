import type { ChatMessage } from "../types/index";

/** HTTP retries, reconnects, and Realtime may all deliver the same message. */
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const unique = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) unique.set(message.id, message);
  return [...unique.values()].sort((a, b) => {
    const milliseconds = (Date.parse(a.createdAt ?? "") || 0) - (Date.parse(b.createdAt ?? "") || 0);
    if (milliseconds) return milliseconds;
    // Postgres preserves microseconds; HTTP and Realtime can format UTC differently.
    const fraction = (value?: string) => (value?.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0").slice(0, 6);
    return fraction(a.createdAt).localeCompare(fraction(b.createdAt)) || a.id.localeCompare(b.id);
  });
}

export function serviceMessage(cause: unknown, fallback: string): string {
  if (cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string") {
    return cause.message;
  }
  return fallback;
}
