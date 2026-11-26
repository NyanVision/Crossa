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
  const sqlPath = join(temporary, 'schedule.sql');
  await writeFile(sqlPath, `select public.configure_crossa_push('https://${project}.supabase.co');\n`, { mode: 0o600 });
  cli('migration', 'up', '--remote=' + project, '--yes');
  cli('functions', 'deploy', 'register-push-device', '--remote=' + project, '--use-api', '--yes');
  cli('functions', 'deploy', 'dispatch-push', '--remote=' + project, '--use-api', '--yes');
  cli('db', 'query', '--remote=' + project, '--file', sqlPath, '--yes');
  console.log('Push registration, delivery worker, and minute scheduler deployed.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
