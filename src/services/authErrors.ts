/** PostgREST errors are plain objects, not necessarily Error instances. */
export function toAuthMessage(error: unknown, fallback: string): string {
  if (typeof error !== "object" || error === null) return fallback;
  const details = error as { code?: unknown; message?: unknown };
  if (["PGRST202", "PGRST205", "42P01", "42883", "42703"].includes(String(details.code))) {
    return "CatchYa's account service is not set up correctly. Please contact support.";
  }
  if (typeof details.message === "string" && details.message.trim()) return details.message;
  return fallback;
}

/** A failed RPC must never be interpreted as a deactivated account. */
export function checkAccountActive(result: { data: unknown; error: unknown }): boolean {
  if (result.error) throw result.error;
  if (typeof result.data !== "boolean") throw new Error("Could not check your account status. Please try again.");
  return result.data;
}
