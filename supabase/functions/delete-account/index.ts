import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS' };
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers });
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' });
  const token = req.headers.get('Authorization')?.replace(/^Bearer /i, '');
  if (!token) return reply(401, { error: 'Sign in first' });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } });
  // Verify against Auth, never trust a client-supplied user ID or decode alone.
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return reply(401, { error: 'Invalid session' });
  const revoked = await admin.auth.admin.signOut(token, 'global');
  if (revoked.error) return reply(500, { error: 'Could not revoke sessions. Try again.' });
  // Storage objects must be removed through the Storage API before deleting the owner.
  while (true) {
    const listed = await admin.storage.from('avatars').list(user.id, { limit: 100 });
    if (listed.error) return reply(500, { error: 'Could not list account photos. Try again.' });
    if (!listed.data.length) break;
    const removed = await admin.storage.from('avatars').remove(listed.data.map(file => user.id + '/' + file.name));
    if (removed.error) return reply(500, { error: 'Could not remove account photos. Try again.' });
  }
  const deleted = await admin.auth.admin.deleteUser(user.id);
  if (deleted.error) return reply(500, { error: 'Could not delete account. Try again.' });
  return reply(200, { deleted: true });
});
