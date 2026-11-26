import { readFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { isIP } from 'node:net';

export function releaseProblems(env) {
  const problems = [];
  const url = env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const key = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
  const email = env.EXPO_PUBLIC_PRIVACY_CONTACT_EMAIL?.trim() ?? '';
  const policy = env.EXPO_PUBLIC_PRIVACY_POLICY_URL?.trim() ?? '';
  if (!/^https:\/\/[a-z]{20}\.supabase\.co\/?$/.test(url)) problems.push('Set the production Supabase project URL.');
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key) || /YOUR|REPLACE|EXAMPLE/i.test(key)) problems.push('Set a real Supabase publishable key; never use a secret/service-role key.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /example\.(com|org|net)$|\.(invalid|test|localhost)$/i.test(email)) problems.push('Set a real public privacy/support contact email.');
  try {
    const parsed = new URL(policy);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || isIP(parsed.hostname.replace(/^\[|\]$/g, '')) || parsed.hostname === 'localhost'
      || /example\.(com|org|net)$|\.(invalid|test|localhost)$/i.test(parsed.hostname)) throw new Error();
  } catch { problems.push('Set the public HTTPS URL of the published privacy policy.'); }
  if (env.CROSSA_RELEASE_DEVICE_CHECKS !== 'confirmed') problems.push('Complete the physical-device release checks and set CROSSA_RELEASE_DEVICE_CHECKS=confirmed.');
  return problems;
}

export function checkTrackedReleaseFiles(root = process.cwd()) {
  const problems = [];
  const app = JSON.parse(readFileSync(resolve(root, 'app.json'), 'utf8')).expo;
  const eas = JSON.parse(readFileSync(resolve(root, 'eas.json'), 'utf8'));
  if (app.ios.bundleIdentifier !== 'com.catchya.app' || app.android.package !== 'com.catchya.app' || app.scheme !== 'catchya') problems.push('Existing native IDs and callback scheme must be preserved for this release.');
  if (eas.build.production.credentialsSource !== 'remote' || eas.build.production.distribution !== 'store') problems.push('Production must use store distribution and managed signing credentials.');
  const gradle = readFileSync(resolve(root, 'android/app/build.gradle'), 'utf8');
  const releaseBlock = gradle.slice(gradle.indexOf('    buildTypes {'));
  const release = releaseBlock.slice(releaseBlock.indexOf('        release {'), releaseBlock.indexOf('    packagingOptions {'));
  if (/signingConfig\s+signingConfigs\.debug/.test(release)) problems.push('Release must not use the debug signing configuration.');
  if (app.android.permissions.includes('android.permission.RECORD_AUDIO')) problems.push('Crossa does not need microphone permission.');
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const production = process.argv.includes('--production') || process.env.EAS_BUILD_PROFILE === 'production';
  if (process.argv.includes('--if-production') && !production) {
    console.log('Production release checks are skipped for this development/preview build.');
  } else {
    try { loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const problems = [...releaseProblems(process.env), ...checkTrackedReleaseFiles()];
    if (problems.length) {
      console.error('Production release is not ready:');
      for (const problem of problems) console.error(`- ${problem}`);
      process.exitCode = 1;
    } else console.log('Production configuration checks passed. Signing credentials and store review are handled separately by Expo and the stores.');
  }
}
