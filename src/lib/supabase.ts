import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, processLock } from '@supabase/supabase-js';

// Publishable client key; database and Storage access are enforced by RLS.
export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://hzqzpvaisxnyixqtzets.supabase.co',
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_aOT4g693q14voXZHaXOnGA_QLB2t9UN',
  { auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true,
    detectSessionInUrl: false, flowType: 'pkce', lock: processLock } },
);
export const authRedirect = 'catchya://auth/callback';
export const recoveryRedirect = 'catchya://auth/recovery';
