-- Keep the inbox current when a request is accepted/declined or read-state changes.
-- Row-level SELECT policies still control which participant receives each event.
do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'connection_requests'
  ) then
    alter publication supabase_realtime add table public.connection_requests;
  end if;
end;
$$;
