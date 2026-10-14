import React, { createContext, useContext, useMemo, useRef, useState } from "react";
import { Linking } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { makeRedirectUri } from "expo-auth-session";
import { requireSupabase, supabase } from "@/services/supabase";
import { forgetPushRegistrationForUser, unregisterPushDevice } from "@/services/notifications";
import { saveUserSettings } from "@/services/userSettings";

WebBrowser.maybeCompleteAuthSession();

type AuthStatus = "signedOut" | "onboarding" | "signedIn" | "recovering";
type OnboardingStep = "about_you" | "profile";
interface AuthContextValue {
  status: AuthStatus;
  userId: string | null;
  error: string | null;
  loading: boolean;
  ready: boolean;
  onboardingStep: OnboardingStep;
  recoveryMode: boolean;
  recoveryComplete: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  createAccount: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  finishPasswordRecovery: () => Promise<void>;
  setOnboardingStep: (step: OnboardingStep) => Promise<void>;
  completeOnboarding: () => Promise<void>;
  signOut: () => Promise<void>;
  deactivateAccount: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const redirectTo = makeRedirectUri({ scheme: "catchya", path: "auth/callback" });
const recoveryRedirectTo = makeRedirectUri({ scheme: "catchya", path: "auth/reset-password" });

type AuthSession = NonNullable<Awaited<ReturnType<NonNullable<typeof supabase>["auth"]["getSession"]>>["data"]["session"]>;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("signedOut");
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [onboardingStep, setOnboardingStepState] = useState<OnboardingStep>("about_you");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryComplete, setRecoveryComplete] = useState(false);
  const handledCodes = useRef(new Set<string>());
  const activeRef = useRef(true);

  React.useEffect(() => {
    const client = supabase;
    activeRef.current = true;
    if (!client) {
      setReady(true);
      return () => { activeRef.current = false; };
    }

    const bootstrap = async (session: AuthSession, allowReactivate = false) => {
      const id = session.user.id;
      try {
        const { data: accountState, error: stateError } = await client.rpc("my_account_state");
        if (stateError) throw stateError;
        if (accountState === "suspended") {
          await client.auth.signOut({ scope: "local" });
          if (activeRef.current) {
            setUserId(null);
            setStatus("signedOut");
            setError("This account is suspended. Contact CatchYa support if you think this is a mistake.");
          }
          return;
        }
        if (accountState === "deactivated") {
          if (!allowReactivate) {
            await client.auth.signOut({ scope: "local" });
            if (activeRef.current) {
              setUserId(null);
              setStatus("signedOut");
              setError("This account is deactivated. Sign in again to reactivate it.");
            }
            return;
          }
          const { data: reactivated, error: reactivateError } = await client.rpc("reactivate_my_account");
          if (reactivateError) throw reactivateError;
          if (reactivated !== true) throw new Error("This account could not be reactivated.");
        } else if (accountState !== "active") {
          throw new Error("This account could not be verified. Check your connection and try again.");
        }

        const { data: profile, error: profileError } = await client.from("profiles")
          .select("onboarding_completed,onboarding_step,display_name").eq("id", id).maybeSingle();
        if (profileError) throw profileError;
        if (!profile) throw new Error("Your profile is still being created. Try again in a moment.");
        const step: OnboardingStep = profile.onboarding_step === "profile" ? "profile" : "about_you";
        if (!activeRef.current) return;
        setUserId(id);
        setOnboardingStepState(step);
        setStatus(profile.onboarding_completed ? "signedIn" : "onboarding");
        setError(null);
      } catch (cause) {
        if (activeRef.current) {
          setError(toAuthMessage(cause, "Could not verify your account. Check your connection and retry."));
          setUserId(id);
          setStatus("signedOut");
        }
      }
    };

    const processAuthUrl = async (url: string) => {
      let parsed: URL;
      try { parsed = new URL(url); } catch { return; }
      const query = parsed.searchParams;
      const hash = new URLSearchParams(parsed.hash.replace(/^#/, ""));
      const flowType = query.get("type") ?? hash.get("type");
      if (flowType === "recovery") {
        setRecoveryMode(true);
        setRecoveryComplete(false);
        setStatus("recovering");
      }
      const code = query.get("code");
      if (code && !handledCodes.current.has(code)) {
        handledCodes.current.add(code);
        const { data, error: exchangeError } = await client.auth.exchangeCodeForSession(code);
        if (exchangeError) throw exchangeError;
        if (!data.session) throw new Error("The email link did not return an active session. Request a new link and try again.");
        if (flowType === "recovery") {
          setUserId(data.session.user.id);
          setRecoveryMode(true);
          setRecoveryComplete(false);
          setStatus("recovering");
        } else {
          await bootstrap(data.session, false);
        }
        return;
      }
      const accessToken = hash.get("access_token") ?? query.get("access_token");
      const refreshToken = hash.get("refresh_token") ?? query.get("refresh_token");
      if (accessToken && refreshToken) {
        const { data, error: sessionError } = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (sessionError) throw sessionError;
        if (data.session && flowType === "recovery") {
          setUserId(data.session.user.id);
          setRecoveryMode(true);
          setRecoveryComplete(false);
          setStatus("recovering");
        } else if (data.session) await bootstrap(data.session, false);
      }
      const callbackError = query.get("error_description") ?? query.get("error") ?? hash.get("error_description") ?? hash.get("error");
      if (callbackError) setError(callbackError.replaceAll("+", " "));
    };

    let cancelled = false;
    const restore = async () => {
      try {
        const [{ data: { session }, error: sessionError }, initialUrl] = await Promise.all([
          client.auth.getSession(), Linking.getInitialURL(),
        ]);
        if (sessionError) throw sessionError;
        if (initialUrl) await processAuthUrl(initialUrl);
        else if (session?.user) await bootstrap(session, false);
        else if (activeRef.current) { setStatus("signedOut"); setUserId(null); }
      } catch (cause) {
        if (activeRef.current) {
          setError(toAuthMessage(cause, "Could not restore your session. Check your connection and retry."));
          setStatus("signedOut");
        }
      } finally {
        if (!cancelled && activeRef.current) setReady(true);
      }
    };
    void restore();

    const linkSubscription = Linking.addEventListener("url", ({ url }) => {
      void processAuthUrl(url).catch((cause) => setError(toAuthMessage(cause, "This sign-in link could not be opened. Request a new one.")));
    });
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (!activeRef.current) return;
      if (event === "PASSWORD_RECOVERY") {
        setRecoveryMode(true);
        setRecoveryComplete(false);
        setStatus("recovering");
        setUserId(session?.user.id ?? null);
        return;
      }
      if (event === "SIGNED_OUT" || !session?.user) {
        setRecoveryMode(false);
        setRecoveryComplete(false);
        setUserId(null);
        setStatus("signedOut");
        return;
      }
      if (event === "TOKEN_REFRESHED") {
        // Defer Supabase queries out of the auth callback to avoid blocking its lock.
        setTimeout(() => { if (activeRef.current) void bootstrap(session, false); }, 0);
      }
    });

    return () => {
      cancelled = true;
      activeRef.current = false;
      linkSubscription.remove();
      subscription.unsubscribe();
    };
  }, []);

  const finishLogin = async (session: AuthSession) => {
    setError(null);
    const client = requireSupabase();
    try {
      const { data: accountState, error: stateError } = await client.rpc("my_account_state");
      if (stateError) throw stateError;
      if (accountState === "suspended") throw new Error("This account is suspended. Contact CatchYa support if you think this is a mistake.");
      if (accountState === "deactivated") {
        const { data, error } = await client.rpc("reactivate_my_account");
        if (error) throw error;
        if (data !== true) throw new Error("This account could not be reactivated.");
      } else if (accountState !== "active") {
        throw new Error("This account could not be verified. Check your connection and try again.");
      }
      const { data: profile, error: profileError } = await client.from("profiles")
        .select("onboarding_completed,onboarding_step").eq("id", session.user.id).maybeSingle();
      if (profileError) throw profileError;
      if (!profile) throw new Error("Your profile is still being created. Try again in a moment.");
      setUserId(session.user.id);
      setOnboardingStepState(profile.onboarding_step === "profile" ? "profile" : "about_you");
      setStatus(profile.onboarding_completed ? "signedIn" : "onboarding");
    } catch (cause) {
      await client.auth.signOut({ scope: "local" });
      setUserId(null);
      setStatus("signedOut");
      throw cause;
    }
  };

  const signInWithGoogle = async () => {
    setError(null);
    setLoading(true);
    try {
      const client = requireSupabase();
      const { data, error: oauthError } = await client.auth.signInWithOAuth({
        provider: "google", options: { redirectTo, skipBrowserRedirect: true },
      });
      if (oauthError) throw oauthError;
      if (!data.url) throw new Error("Supabase did not return a Google sign-in URL.");
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type === "cancel" || result.type === "dismiss") return;
      if (result.type !== "success") throw new Error("Google sign-in did not complete. Please try again.");
      const parsed = new URL(result.url);
      const callbackError = parsed.searchParams.get("error_description") ?? parsed.searchParams.get("error");
      if (callbackError) throw new Error(callbackError.replaceAll("+", " "));
      const code = parsed.searchParams.get("code");
      if (!code) throw new Error("Google sign-in did not return an authorization code.");
      const { data: sessionData, error: exchangeError } = await client.auth.exchangeCodeForSession(code);
      if (exchangeError) throw exchangeError;
      if (!sessionData.session) throw new Error("Google sign-in returned no session.");
      handledCodes.current.add(code);
      await finishLogin(sessionData.session);
    } catch (cause) {
      setError(toAuthMessage(cause, "Google sign-in failed. Check Supabase Google provider and redirect configuration."));
    } finally { setLoading(false); }
  };

  const signInWithEmail = async (email: string, password: string) => {
    setError(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) { setError("Enter your email and password to continue."); return; }
    setLoading(true);
    try {
      const { data, error: signInError } = await requireSupabase().auth.signInWithPassword({ email: normalizedEmail, password });
      if (signInError) throw signInError;
      if (!data.session) throw new Error("Sign-in did not return an active session.");
      await finishLogin(data.session);
    } catch (cause) { setError(toAuthMessage(cause, "Could not sign in. Check your email and password.")); }
    finally { setLoading(false); }
  };

  const createAccount = async (email: string, password: string) => {
    setError(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) { setError("Fill in every field to create your account."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    setLoading(true);
    try {
      const { data, error: signUpError } = await requireSupabase().auth.signUp({
        email: normalizedEmail, password, options: { emailRedirectTo: redirectTo },
      });
      if (signUpError) throw signUpError;
      if (!data.user) throw new Error("Account creation did not return an account.");
      if (!data.session) {
        setError("Check your email to confirm your account, then return here and sign in.");
        return;
      }
      await finishLogin(data.session);
    } catch (cause) { setError(toAuthMessage(cause, "Could not create your account. Please try again.")); }
    finally { setLoading(false); }
  };

  const resetPassword = async (email: string) => {
    setError(null);
    if (!email.trim()) { setError("Enter your email address first."); return; }
    setLoading(true);
    try {
      const { error: resetError } = await requireSupabase().auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: recoveryRedirectTo });
      if (resetError) throw resetError;
      setError("If that email is registered, a password reset link has been sent.");
    } catch (cause) { setError(toAuthMessage(cause, "Could not send a reset email. Please try again.")); }
    finally { setLoading(false); }
  };

  const updatePassword = async (password: string) => {
    if (!recoveryMode) throw new Error("Open a valid password reset link before choosing a new password.");
    if (password.length < 8) throw new Error("Password must be at least 8 characters.");
    setLoading(true);
    try {
      const { data, error: updateError } = await requireSupabase().auth.updateUser({ password });
      if (updateError) throw updateError;
      if (!data.user) throw new Error("The password was not updated. Request a new recovery link and try again.");
      setError(null);
      setRecoveryComplete(true);
    } finally { setLoading(false); }
  };

  const finishPasswordRecovery = async () => {
    setLoading(true);
    try {
      const { data: { session }, error: sessionError } = await requireSupabase().auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) throw new Error("Your recovery session expired. Request a new password reset link.");
      setRecoveryMode(false);
      setRecoveryComplete(false);
      await finishLogin(session);
    } finally { setLoading(false); }
  };

  const setOnboardingStep = async (step: OnboardingStep) => {
    const { data, error } = await requireSupabase().rpc("set_my_onboarding_step", { p_step: step });
    if (error) throw error;
    if (data !== true) throw new Error("Could not save your onboarding progress.");
    setOnboardingStepState(step);
  };

  const completeOnboarding = async () => {
    const { data, error } = await requireSupabase().rpc("complete_my_onboarding");
    if (error) throw error;
    if (data !== true) throw new Error("Add a display name before finishing your profile.");
    setOnboardingStepState("profile");
    setStatus("signedIn");
  };

  const signOut = async () => {
    setError(null);
    const client = requireSupabase();
    if (userId) {
      // Suppress delivery first; if token removal fails, keep the session active so
      // the user can retry instead of signing out with a stale enabled device token.
      await saveUserSettings(userId, { notificationsEnabled: false });
      await unregisterPushDevice();
    }
    const { error: signOutError } = await client.auth.signOut();
    if (signOutError) throw signOutError;
    setUserId(null);
    setRecoveryMode(false);
    setRecoveryComplete(false);
    setStatus("signedOut");
  };

  const deactivateAccount = async () => {
    const client = requireSupabase();
    const { error: deactivateError } = await client.rpc("deactivate_my_account");
    if (deactivateError) throw deactivateError;
    try { await unregisterPushDevice(); } catch { /* account status stops delivery if this device is offline */ }
    await client.auth.signOut({ scope: "local" });
    setUserId(null);
    setStatus("signedOut");
  };

  const deleteAccount = async () => {
    const client = requireSupabase();
    const { error: deleteError } = await client.functions.invoke("delete-account", { body: {} });
    if (deleteError) throw deleteError;
    if (userId) await forgetPushRegistrationForUser(userId).catch(() => undefined);
    await client.auth.signOut({ scope: "local" });
    setUserId(null);
    setStatus("signedOut");
    setRecoveryMode(false);
    setRecoveryComplete(false);
  };

  const value = useMemo(() => ({
    status, userId, error, loading, ready, onboardingStep, recoveryMode, recoveryComplete,
    signInWithGoogle, signInWithEmail, createAccount, resetPassword, updatePassword, finishPasswordRecovery,
    setOnboardingStep, completeOnboarding, signOut, deactivateAccount, deleteAccount,
    clearError: () => setError(null),
  }), [status, userId, error, loading, ready, onboardingStep, recoveryMode, recoveryComplete]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function toAuthMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  return fallback;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
