export interface AuthLink {
  code: string | null;
  flowId: string | null;
  tokens: { access_token: string; refresh_token: string } | null;
  recovery: boolean;
}

/** Only consume links for this app's exact auth destinations. Never log their tokens. */
export function parseAuthLink(raw: string, callbackUrl: string, recoveryUrl: string): AuthLink | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  const destination = (value: URL) => `${value.protocol}//${value.host}${value.pathname.replace(/\/$/, "")}`;
  if (url.username || url.password || ![callbackUrl, recoveryUrl].some((value) => destination(new URL(value)) === destination(url))) return null;
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  const get = (name: string) => url.searchParams.get(name) ?? hash.get(name);
  const error = get("error_description") ?? get("error");
  if (error) throw new Error(error.replaceAll("+", " "));
  const code = get("code");
  const access = get("access_token");
  const refresh = get("refresh_token");
  if (!code && !access && !refresh) return null;
  if (!code && (!access || !refresh)) throw new Error("This sign-in link is incomplete. Request a new link.");
  return {
    code, flowId: get("sb_flow_id"),
    tokens: access && refresh ? { access_token: access, refresh_token: refresh } : null,
    recovery: destination(url) === destination(new URL(recoveryUrl)) || get("type") === "recovery",
  };
}

/** Cold/warm links and the OAuth browser result can deliver the same one-use code. */
export function createAuthLinkHandler<T>(options: {
  callbackUrl: string;
  recoveryUrl: string;
  exchangeCode: (code: string, flowId: string | null) => Promise<T>;
  setTokens: (tokens: NonNullable<AuthLink["tokens"]>) => Promise<T>;
  onSession: (session: T, recovery: boolean) => Promise<void>;
}) {
  const pending = new Map<string, Promise<boolean>>();
  const completed = new Set<string>();
  const verified = new Map<string, T>();
  return async (raw: string): Promise<boolean> => {
    const link = parseAuthLink(raw, options.callbackUrl, options.recoveryUrl);
    if (!link) return false;
    const key = link.code ? "code:" + (link.flowId ?? "") + ":" + link.code : "token:" + link.tokens!.access_token;
    if (completed.has(key)) return true;
    const existing = pending.get(key);
    if (existing) return existing;
    const operation = (async () => {
      const session = verified.get(key) ?? (link.code
        ? await options.exchangeCode(link.code, link.flowId)
        : await options.setTokens(link.tokens!));
      // Profile loading can fail after a one-use code has already been consumed.
      // Retry that transition with its verified session rather than re-exchanging.
      verified.set(key, session);
      if (verified.size > 20) verified.delete(verified.keys().next().value!);
      await options.onSession(session, link.recovery);
      // Keep a bounded in-memory cache; failed exchanges remain retryable.
      completed.add(key);
      if (completed.size > 20) completed.delete(completed.values().next().value!);
      return true;
    })();
    pending.set(key, operation);
    try { return await operation; } finally { pending.delete(key); }
  };
}

export function passwordValidationError(password: string, confirmation: string): string | null {
  if (password.length < 8) return "Use at least 8 characters for your new password.";
  if (password !== confirmation) return "Your passwords do not match.";
  return null;
}
