import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const flag = process.argv.indexOf('--project-ref');
const project = flag >= 0 ? process.argv[flag + 1] : '';
if (!/^[a-z]{20}$/.test(project ?? '')) {
  throw new Error('Usage: npm run push:deploy -- --project-ref YOUR_PROJECT_REF');
}
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
function cli(...args) {
  const result = spawnSync(npx, ['--yes', 'supabase@3.2.0', ...args], { stdio: 'inherit', shell: false });
  if (result.error || result.status !== 0) throw new Error('Supabase deployment failed. Check the preceding CLI error and retry.');
}

const temporary = await mkdtemp(join(tmpdir(), 'crossa-push-'));
try {
  const secret = randomBytes(32).toString('hex');
  const envPath = join(temporary, 'push.env');
  const sqlPath = join(temporary, 'schedule.sql');
  await writeFile(envPath, 'PUSH_WORKER_SECRET=' + secret + '\n', { mode: 0o600 });
  // Never put secrets in command-line arguments, app bundles, or committed SQL.
  await writeFile(sqlPath, `
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;
do $setup$
declare secret_id uuid;
begin
  select id into secret_id from vault.secrets where name = 'crossa_push_worker';
  if secret_id is null then
    perform vault.create_secret('${secret}', 'crossa_push_worker', 'Crossa push scheduler');
  else
    perform vault.update_secret(secret_id, '${secret}', 'crossa_push_worker', 'Crossa push scheduler');
  end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'crossa-dispatch-push';
end;
$setup$;
select cron.schedule('crossa-dispatch-push', '* * * * *', $job$
  select net.http_post(
    url := 'https://${project}.supabase.co/functions/v1/dispatch-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'crossa_push_worker')),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
$job$);
`, { mode: 0o600 });
  cli('migration', 'up', '--remote=' + project, '--yes');
  cli('secrets', 'set', '--remote=' + project, '--env-file', envPath, '--yes');
  cli('functions', 'deploy', 'register-push-device', '--remote=' + project, '--use-api', '--yes');
  cli('functions', 'deploy', 'dispatch-push', '--remote=' + project, '--use-api', '--yes');
  cli('db', 'query', '--remote=' + project, '--file', sqlPath, '--yes');
  console.log('Push registration, delivery worker, and minute scheduler deployed.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
