-- Keep scheduler credentials in Vault; the Edge Function verifies them through
-- a service-role-only RPC. No worker secret is shipped in an app or migration.
create function public.verify_crossa_push_secret(p_secret text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_expected text;
begin
  if p_secret is null or char_length(p_secret) not between 32 and 256 then return false; end if;
  select decrypted_secret into v_expected from vault.decrypted_secrets where name='crossa_push_worker';
  if v_expected is null then return false; end if;
  return sha256(convert_to(p_secret,'UTF8'))=sha256(convert_to(v_expected,'UTF8'));
end;
$$;
create function public.configure_crossa_push(p_project_url text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_url_id uuid;
begin
  if p_project_url is null or p_project_url !~ '^https://[a-z]{20}\.supabase\.co$' then raise exception 'Use the Supabase project API URL.'; end if;
  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net with schema extensions';
  execute 'create extension if not exists supabase_vault with schema vault';
  if not exists(select 1 from vault.secrets where name='crossa_push_worker') then
    perform vault.create_secret(gen_random_uuid()::text||gen_random_uuid()::text,'crossa_push_worker','Crossa push scheduler');
  end if;
  select id into v_url_id from vault.secrets where name='crossa_push_url';
  if v_url_id is null then perform vault.create_secret(p_project_url,'crossa_push_url','Crossa push API URL');
  else perform vault.update_secret(v_url_id,p_project_url,'crossa_push_url','Crossa push API URL'); end if;
  perform cron.unschedule(jobid) from cron.job where jobname='crossa-dispatch-push';
  perform cron.schedule('crossa-dispatch-push','* * * * *',$job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='crossa_push_url')||'/functions/v1/dispatch-push',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||
        (select decrypted_secret from vault.decrypted_secrets where name='crossa_push_worker')),
      body := '{}'::jsonb, timeout_milliseconds := 55000
    );
  $job$);
  return true;
end;
$$;
revoke all on function public.verify_crossa_push_secret(text),public.configure_crossa_push(text) from public,anon,authenticated;
grant execute on function public.verify_crossa_push_secret(text),public.configure_crossa_push(text) to service_role;
