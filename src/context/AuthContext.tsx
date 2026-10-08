import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { type Session } from '@supabase/supabase-js';
import { supabase, authRedirect, recoveryRedirect } from '@/lib/supabase';

WebBrowser.maybeCompleteAuthSession();
type AuthStatus = 'signedOut' | 'onboarding' | 'signedIn';
interface AuthContextValue {
  status: AuthStatus; userId: string | null; error: string | null; loading: boolean;
  initializing: boolean; recovering: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  createAccount: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  completeOnboarding: () => Promise<void>;
  signOut: () => Promise<void>; deleteAccount: () => Promise<void>; clearError: () => void;
}
const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const clearSharedDemoData = () => AsyncStorage.multiRemove([
  'catchya:inboxConversations', 'catchya:blockedProfiles',
  'catchya:profileReports', 'catchya:outgoingMessageRequests',
]);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('signedOut');
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [recovering, setRecovering] = useState(false);
  const callbackInFlight = useRef<Promise<void> | null>(null);
  const handledUrl = useRef<string | null>(null);

  async function consumeCallback(url: string) {
    if (!url.startsWith(authRedirect) && !url.startsWith(recoveryRedirect)) return;
    if (handledUrl.current === url) return callbackInFlight.current;
    handledUrl.current = url;
    callbackInFlight.current = (async () => {
      const parsed = new URL(url);
      const message = parsed.searchParams.get('error_description');
      if (message) throw new Error(message);
      const code = parsed.searchParams.get('code');
      if (!code) throw new Error('This sign-in link is invalid. Request a new link.');
      const isRecovery = url.startsWith(recoveryRedirect);
      if (isRecovery) setRecovering(true);
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeError) { if (isRecovery) setRecovering(false); throw exchangeError; }
    })();
    try { await callbackInFlight.current; }
    finally { callbackInFlight.current = null; }
  }

  useEffect(() => {
    let active = true;
    let revision = 0;
    const syncSession = async (session: Session | null) => {
      const current = ++revision;
      if (!active) return;
      setUserId(session?.user.id ?? null);
      if (!session) {
        await clearSharedDemoData();
        if (!active || revision !== current) return;
        setStatus('signedOut'); setRecovering(false); setInitializing(false); return;
      }
      const { data, error: profileError } = await supabase.from('profiles')
        .select('onboarding_completed').eq('id', session.user.id).maybeSingle();
      if (!active || revision !== current) return;
      if (profileError) {
        setError('Could not load your account. Check your connection and sign in again.');
        setStatus('signedOut');
      } else setStatus(data?.onboarding_completed ? 'signedIn' : 'onboarding');
      setInitializing(false);
    };
    // Defer database work outside the Auth callback to avoid holding its lock.
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      setTimeout(() => { if (active) void syncSession(session); }, 0);
    });
    const handleUrl = (url: string) => { void consumeCallback(url).catch(e => { if (active) setError(e.message); }); };
    const links = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    void Linking.getInitialURL().then(url => { if (active && url) handleUrl(url); }).catch(() => undefined);
    const refresh = (state: string) => {
      if (state === 'active') supabase.auth.startAutoRefresh(); else supabase.auth.stopAutoRefresh();
    };
    refresh(AppState.currentState);
    const appState = AppState.addEventListener('change', refresh);
    // Device-only accounts are never treated as authenticated Supabase users.
    void AsyncStorage.multiRemove(['catchya:lastUser', 'catchya:localTestAccounts']);
    return () => { active = false; revision++; listener.subscription.unsubscribe(); links.remove(); appState.remove(); supabase.auth.stopAutoRefresh(); };
  }, []);

  const run = async (action: () => Promise<void>) => {
    setError(null); setLoading(true);
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Please try again.'); }
    finally { setLoading(false); }
  };
  const signInWithEmail = (email: string, password: string) => run(async () => {
    if (!email.trim() || !password) throw new Error('Enter your email and password.');
    const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (result.error) throw result.error;
  });
  const createAccount = (email: string, password: string) => run(async () => {
    if (password.length < 8) throw new Error('Use a password with at least 8 characters.');
    const { data, error: authError } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: authRedirect } });
    if (authError) throw authError;
    if (!data.session) Alert.alert('Check your email', 'Open the confirmation link on this device, then sign in.');
  });
  const signInWithGoogle = () => run(async () => {
    const { data, error: authError } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: authRedirect, skipBrowserRedirect: true } });
    if (authError) throw authError;
    const result = await WebBrowser.openAuthSessionAsync(data.url, authRedirect);
    if (result.type === 'success') await consumeCallback(result.url);
  });
  const resetPassword = (email: string) => run(async () => {
    if (!email.trim()) throw new Error('Enter your email address.');
    const { error: authError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: recoveryRedirect });
    if (authError) throw authError;
    Alert.alert('Check your email', 'If an account exists for this address, you will receive a reset link. Open it on this device.');
  });
  const updatePassword = (password: string) => run(async () => {
    if (!recovering) throw new Error('Open a password reset link first.');
    if (password.length < 8) throw new Error('Use at least 8 characters.');
    const { error: authError } = await supabase.auth.updateUser({ password });
    if (authError) throw authError;
    setRecovering(false);
    Alert.alert('Password updated', 'Your new password is ready to use.');
  });
  const completeOnboarding = async () => {
    if (!userId) throw new Error('Sign in first.');
    const { error: profileError } = await supabase.from('profiles').update({ onboarding_completed: true }).eq('id', userId).select('id').single();
    if (profileError) throw profileError;
    setStatus('signedIn');
  };
  const signOut = async () => {
    const { error: authError } = await supabase.auth.signOut();
    if (authError) throw authError;
    await clearSharedDemoData();
    setUserId(null); setStatus('signedOut'); setRecovering(false); setError(null);
  };
  const deleteAccount = async () => {
    const { error: deleteError } = await supabase.functions.invoke('delete-account', { body: {} });
    if (deleteError) throw deleteError;
    await supabase.auth.signOut({ scope: 'local' });
    await AsyncStorage.multiRemove([`catchya:discovery:${userId}`, `catchya:notificationsEnabled:${userId}`,
      'catchya:inboxConversations', 'catchya:blockedProfiles', 'catchya:profileReports', 'catchya:outgoingMessageRequests']);
    setUserId(null); setStatus('signedOut'); setRecovering(false); setError(null);
  };
  return <AuthContext.Provider value={{ status, userId, error, loading, initializing, recovering,
    signInWithGoogle, signInWithEmail, createAccount, resetPassword, updatePassword,
    completeOnboarding, signOut, deleteAccount, clearError: () => setError(null) }}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
