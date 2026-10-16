import React, { createContext, useContext, useMemo, useState } from "react";
import * as WebBrowser from "expo-web-browser";
import { makeRedirectUri } from "expo-auth-session";
import { requireSupabase, supabase } from "@/services/supabase";
import { toAuthMessage, checkAccountActive } from "@/services/authErrors";

WebBrowser.maybeCompleteAuthSession();

type AuthStatus = "signedOut" | "onboarding" | "signedIn";

interface AuthContextValue {
  status: AuthStatus;
  userId: string | null;
  error: string | null;
  loading: boolean;
  ready: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  createAccount: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  completeOnboarding: () => void;
  signOut: () => Promise<void>;
  deactivateAccount: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const redirectTo = makeRedirectUri({ scheme: "catchya", path: "auth/callback" });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("signedOut");
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  React.useEffect(() => {
    const client = supabase;
    if (!client) {
      setReady(true);
      return;
    }
    let active = true;
    const resolveSession = async () => {
      try {
        const { data: { session }, error: sessionError } = await client.auth.getSession();
        if (sessionError) throw sessionError;
        if (!active) return;
        if (!session?.user) {
          setStatus("signedOut");
          setUserId(null);
          return;
        }
        const accountActive = checkAccountActive(await client.rpc("my_account_is_active"));
        if (!accountActive) {
          await client.auth.signOut();
          if (active) {
            setStatus("signedOut");
            setUserId(null);
            setError("This account is deactivated. Sign in again to reactivate it, or create a new account.");
          }
          return;
        }
        const nextStatus = await getProfileStatus(session.user.id);
        if (active) {
          setUserId(session.user.id);
          setStatus(nextStatus);
        }
      } catch (cause) {
        if (active) setError(toAuthMessage(cause, "Could not restore your session. Please try signing in again."));
      } finally {
        if (active) setReady(true);
      }
    };
    void resolveSession();
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (!session?.user) {
        setUserId(null);
        setStatus("signedOut");
      } else {
        setUserId(session.user.id);
      }
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const finishLogin = async (id: string) => {
    const client = requireSupabase();
    const { error: reactivateError } = await client.rpc("reactivate_my_account");
    if (reactivateError) throw reactivateError;
    const nextStatus = await getProfileStatus(id);
    setUserId(id);
    setStatus(nextStatus);
    setError(null);
  };

  const signInWithGoogle = async () => {
    setError(null);
    setLoading(true);
    try {
      const client = requireSupabase();
      const { data, error: oauthError } = await client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (oauthError) throw oauthError;
      if (!data.url) throw new Error("Supabase did not return a Google sign-in URL.");
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type === "cancel" || result.type === "dismiss") return;
      if (result.type !== "success") throw new Error("Google sign-in did not complete. Please try again.");
      const callback = new URL(result.url);
      const authError = callback.searchParams.get("error_description") ?? callback.searchParams.get("error");
      if (authError) throw new Error(authError.replaceAll("+", " "));
      const code = callback.searchParams.get("code");
      if (!code) throw new Error("Google sign-in did not return an authorization code.");
      const { data: sessionData, error: exchangeError } = await client.auth.exchangeCodeForSession(code);
      if (exchangeError) throw exchangeError;
      if (!sessionData.user) throw new Error("Google sign-in returned no account.");
      await finishLogin(sessionData.user.id);
    } catch (cause) {
      setError(toAuthMessage(cause, "Google sign-in failed. Check Supabase Google provider and redirect configuration."));
    } finally {
      setLoading(false);
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    setError(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) { setError("Enter your email and password to continue."); return; }
    setLoading(true);
    try {
      const { data, error: signInError } = await requireSupabase().auth.signInWithPassword({ email: normalizedEmail, password });
      if (signInError) throw signInError;
      if (!data.user) throw new Error("Sign-in did not return an account.");
      await finishLogin(data.user.id);
    } catch (cause) {
      setError(toAuthMessage(cause, "Could not sign in. Check your email and password."));
    } finally { setLoading(false); }
  };

  const createAccount = async (email: string, password: string) => {
    setError(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) { setError("Fill in every field to create your account."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    setLoading(true);
    try {
      const { data, error: signUpError } = await requireSupabase().auth.signUp({ email: normalizedEmail, password });
      if (signUpError) throw signUpError;
      if (!data.user) throw new Error("Account creation did not return an account.");
      if (!data.session) {
        setError("Check your email to confirm your account, then sign in to continue.");
        return;
      }
      setUserId(data.user.id);
      setStatus("onboarding");
    } catch (cause) {
      setError(toAuthMessage(cause, "Could not create your account. Please try again."));
    } finally { setLoading(false); }
  };

  const resetPassword = async (email: string) => {
    setError(null);
    if (!email.trim()) { setError("Enter your email address first."); return; }
    setLoading(true);
    try {
      const { error: resetError } = await requireSupabase().auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo });
      if (resetError) throw resetError;
      setError("If that email is registered, a password reset link has been sent.");
    } catch (cause) {
      setError(toAuthMessage(cause, "Could not send a reset email. Please try again."));
    } finally { setLoading(false); }
  };

  const completeOnboarding = () => setStatus("signedIn");

  const signOut = async () => {
    setError(null);
    const client = requireSupabase();
    const { error: signOutError } = await client.auth.signOut();
    if (signOutError) throw signOutError;
    setUserId(null);
    setStatus("signedOut");
  };

  const deactivateAccount = async () => {
    const client = requireSupabase();
    const { error: deactivateError } = await client.rpc("deactivate_my_account");
    if (deactivateError) throw deactivateError;
    const { error: signOutError } = await client.auth.signOut();
    if (signOutError) throw signOutError;
    setUserId(null);
    setStatus("signedOut");
  };

  const deleteAccount = async () => {
    const client = requireSupabase();
    const { error: deleteError } = await client.functions.invoke("delete-account", { body: {} });
    if (deleteError) throw deleteError;
    await client.auth.signOut();
    setUserId(null);
    setStatus("signedOut");
  };

  const value = useMemo(() => ({
    status, userId, error, loading, ready,
    signInWithGoogle, signInWithEmail, createAccount, resetPassword,
    completeOnboarding, signOut, deactivateAccount, deleteAccount,
    clearError: () => setError(null),
  }), [status, userId, error, loading, ready]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

async function getProfileStatus(id: string): Promise<AuthStatus> {
  const { data, error } = await requireSupabase().from("profiles")
    .select("display_name,account_status").eq("id", id).maybeSingle();
  if (error) throw error;
  if (data?.account_status === "deactivated") throw new Error("This account is deactivated. Sign in again to reactivate it.");
  return data?.display_name?.trim() ? "signedIn" : "onboarding";
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
