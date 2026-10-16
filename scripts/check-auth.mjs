import { loadEnvFile } from 'node:process';
import { getSupabaseConfigurationError } from '../src/services/supabaseConfig.ts';

try { loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
const problem = getSupabaseConfigurationError(url, key);
if (problem) {
  console.error(problem);
  process.exitCode = 1;
} else {
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/auth/v1/settings`, {
      headers: { apikey: key }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Auth settings request failed (HTTP ${response.status}). Check the project URL, publishable key and project status.`);
    const settings = await response.json();
    console.log(`Auth reachable. Email provider: ${settings.external?.email === true ? 'enabled' : 'disabled'}. Google provider: ${settings.external?.google === true ? 'enabled' : 'disabled'}.`);
    console.log('This checks connectivity and provider settings only. Account login, migrations and OAuth redirects still require device testing.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
