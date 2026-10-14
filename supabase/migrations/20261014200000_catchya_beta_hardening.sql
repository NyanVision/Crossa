-- Forward-only beta hardening for an already-initialized CatchYa schema.
-- Does not drop user data, reset the database, or change the existing 13–120 age range.

alter table public.profiles
  add column if not exists onboarding_completed boolean not null default false,
  add column if not exists onboarding_step text not null default 'about_you',
  add column if not exists suspended_at timestamptz,
  add column if not exists suspension_reason text;

alter table public.profiles drop constraint if exists profiles_account_status_check;
alter table public.profiles add constraint profiles_account_status_check
  check (account_status in ('active', 'deactivated', 'suspended'));
alter table public.profiles drop constraint if exists profiles_onboarding_step_check;
alter table public.profiles add constraint profiles_onboarding_step_check
  check (onboarding_step in ('about_you', 'profile', 'complete'));
alter table public.profiles add constraint profiles_suspension_fields_check
  check ((account_status = 'suspended') or (suspended_at is null and suspension_reason is null));

-- Existing completed profiles remain completed. Newly created OAuth profiles are not
-- considered onboarded merely because the provider supplied a display name.
update public.profiles
set onboarding_completed = true, onboarding_step = 'complete'
where not onboarding_completed and length(trim(display_name)) > 0;

create or replace function private.account_is_active(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1 from public.profiles p where p.id = p_user_id and p.account_status = 'active'
  );
$$;
revoke all on function private.account_is_active(uuid) from public, anon;
grant execute on function private.account_is_active(uuid) to authenticated, service_role;

create or replace function private.consume_rate_limit(
  p_actor uuid, p_bucket text, p_max integer, p_window interval
)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_seconds numeric;
  v_start timestamptz;
  v_count integer;
begin
  if p_actor is null or p_bucket is null or p_max < 1 or p_window <= interval '0 seconds' then
    raise exception 'Invalid rate-limit parameters';
  end if;
  v_seconds := extract(epoch from p_window);
  v_start := to_timestamp(floor(extract(epoch from clock_timestamp()) / v_seconds) * v_seconds);
  insert into private.rate_limit_counters(actor_id, bucket, window_start, hits)
  values (p_actor, p_bucket, v_start, 1)
  on conflict (actor_id, bucket, window_start)
  do update set hits = private.rate_limit_counters.hits + 1
  returning hits into v_count;
  return v_count <= p_max;
end;
$$;

create table if not exists private.rate_limit_counters (
  actor_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null check (hits > 0),
  primary key (actor_id, bucket, window_start)
);
alter table private.rate_limit_counters enable row level security;
drop policy if exists rate_limit_counters_deny_client on private.rate_limit_counters;
create policy rate_limit_counters_deny_client on private.rate_limit_counters
  for all to anon, authenticated using (false) with check (false);
revoke all on private.rate_limit_counters from public, anon, authenticated;
revoke all on function private.consume_rate_limit(uuid, text, integer, interval) from public, anon;
grant execute on function private.consume_rate_limit(uuid, text, integer, interval) to authenticated, service_role;

-- One owner-scoped row hides a request/chat only from that user; history remains intact.
create table if not exists public.conversation_user_state (
  request_id uuid not null references public.connection_requests(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  hidden_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (request_id, user_id)
);
alter table public.conversation_user_state enable row level security;
drop policy if exists conversation_state_deny_client on public.conversation_user_state;
create policy conversation_state_deny_client on public.conversation_user_state
  for all to anon, authenticated using (false) with check (false);
revoke all on public.conversation_user_state from public, anon, authenticated;

-- Private tokens and delivery state are never readable or writable by app clients.
create table if not exists public.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  installation_id uuid not null,
  expo_push_token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  last_ticket_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, installation_id)
);
create index if not exists push_devices_user_enabled_idx on public.push_devices(user_id, enabled);
alter table public.push_devices enable row level security;
drop policy if exists push_devices_deny_client on public.push_devices;
create policy push_devices_deny_client on public.push_devices
  for all to anon, authenticated using (false) with check (false);
revoke all on public.push_devices from public, anon, authenticated;
grant all on public.push_devices to service_role;

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null references public.connection_requests(id) on delete cascade,
  kind text not null check (kind in ('request', 'accepted', 'message')),
  status text not null default 'queued' check (status in ('queued', 'processing', 'sent', 'suppressed', 'dead_letter')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists notification_outbox_due_idx
  on public.notification_outbox(status, next_attempt_at, created_at);
alter table public.notification_outbox enable row level security;
drop policy if exists notification_outbox_deny_client on public.notification_outbox;
create policy notification_outbox_deny_client on public.notification_outbox
  for all to anon, authenticated using (false) with check (false);
revoke all on public.notification_outbox from public, anon, authenticated;
grant all on public.notification_outbox to service_role;

create table if not exists public.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references public.notification_outbox(id) on delete cascade,
  device_id uuid not null references public.push_devices(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'processing', 'sent', 'retry', 'invalid', 'suppressed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  ticket_id text,
  last_error text,
  created_at timestamptz not null default now(),
  unique (outbox_id, device_id)
);
create index if not exists push_deliveries_due_idx on public.push_deliveries(status, next_attempt_at);
alter table public.push_deliveries enable row level security;
drop policy if exists push_deliveries_deny_client on public.push_deliveries;
create policy push_deliveries_deny_client on public.push_deliveries
  for all to anon, authenticated using (false) with check (false);
revoke all on public.push_deliveries from public, anon, authenticated;
grant all on public.push_deliveries to service_role;

-- App-client writes are constrained to an active account, including when a stale JWT
-- remains after deactivation or suspension. SECURITY DEFINER RPCs inherit auth.uid().
create or replace function private.guard_active_account_write()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null and not private.account_is_active(auth.uid()) then
    raise exception 'Active account required';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.guard_active_account_write() from public, anon, authenticated;

drop trigger if exists profiles_active_write_guard on public.profiles;
create trigger profiles_active_write_guard before update on public.profiles
  for each row execute function private.guard_active_account_write();
drop trigger if exists profile_links_active_write_guard on public.profile_links;
create trigger profile_links_active_write_guard before insert or update or delete on public.profile_links
  for each row execute function private.guard_active_account_write();
drop trigger if exists user_preferences_active_write_guard on public.user_preferences;
create trigger user_preferences_active_write_guard before insert or update or delete on public.user_preferences
  for each row execute function private.guard_active_account_write();
drop trigger if exists discovery_preferences_active_write_guard on public.discovery_preferences;
create trigger discovery_preferences_active_write_guard before insert or update or delete on public.discovery_preferences
  for each row execute function private.guard_active_account_write();
drop trigger if exists requests_active_write_guard on public.connection_requests;
create trigger requests_active_write_guard before insert or update or delete on public.connection_requests
  for each row execute function private.guard_active_account_write();
drop trigger if exists messages_active_write_guard on public.messages;
create trigger messages_active_write_guard before insert or update or delete on public.messages
  for each row execute function private.guard_active_account_write();
drop trigger if exists blocks_active_write_guard on public.user_blocks;
create trigger blocks_active_write_guard before insert or update or delete on public.user_blocks
  for each row execute function private.guard_active_account_write();
drop trigger if exists reports_active_write_guard on public.profile_reports;
create trigger reports_active_write_guard before insert or update or delete on public.profile_reports
  for each row execute function private.guard_active_account_write();
drop trigger if exists conversation_state_active_write_guard on public.conversation_user_state;
create trigger conversation_state_active_write_guard before insert or update or delete on public.conversation_user_state
  for each row execute function private.guard_active_account_write();

-- Replace additive policies with active-account-aware versions.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated
  using ((select auth.uid()) = id and private.account_is_active((select auth.uid())));
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using ((select auth.uid()) = id and private.account_is_active((select auth.uid())))
  with check ((select auth.uid()) = id and private.account_is_active((select auth.uid())));
drop policy if exists profile_links_select_own on public.profile_links;
create policy profile_links_select_own on public.profile_links for select to authenticated
  using ((select auth.uid()) = user_id and private.account_is_active((select auth.uid())));
drop policy if exists profile_links_insert_own on public.profile_links;
create policy profile_links_insert_own on public.profile_links for insert to authenticated
  with check ((select auth.uid()) = user_id and private.account_is_active((select auth.uid())));
drop policy if exists profile_links_update_own on public.profile_links;
create policy profile_links_update_own on public.profile_links for update to authenticated
  using ((select auth.uid()) = user_id and private.account_is_active((select auth.uid())))
  with check ((select auth.uid()) = user_id and private.account_is_active((select auth.uid())));
drop policy if exists profile_links_delete_own on public.profile_links;
create policy profile_links_delete_own on public.profile_links for delete to authenticated
  using ((select auth.uid()) = user_id and private.account_is_active((select auth.uid())));
drop policy if exists user_preferences_select_own on public.user_preferences;
create policy user_preferences_select_own on public.user_preferences for select to authenticated
  using ((select auth.uid()) = user_id and private.account_is_active((select auth.uid())));
drop policy if exists user_preferences_update_own on public.user_preferences;
create policy user_preferences_update_own on public.user_preferences for update to authenticated
  using ((select auth.uid()) = user_id and private.account_is_active((select auth.uid())))
  with check ((select auth.uid()) = user_id and private.account_is_active((select auth.uid())));
drop policy if exists discovery_preferences_select_own on public.discovery_preferences;
create policy discovery_preferences_select_own on public.discovery_preferences for select to authenticated
  using ((select auth.uid()) = user_id and private.account_is_active((select auth.uid())));
drop policy if exists requests_select_participant on public.connection_requests;
create policy requests_select_participant on public.connection_requests for select to authenticated
  using ((sender_id = (select auth.uid()) or recipient_id = (select auth.uid()))
    and private.account_is_active((select auth.uid()))
    and not private.users_are_blocked(sender_id, recipient_id));
drop policy if exists messages_select_accepted_participant on public.messages;
create policy messages_select_accepted_participant on public.messages for select to authenticated
  using (private.account_is_active((select auth.uid())) and exists (
    select 1 from public.connection_requests r
    where r.id = request_id and r.status = 'accepted'
      and (r.sender_id = (select auth.uid()) or r.recipient_id = (select auth.uid()))
      and private.account_is_active(r.sender_id) and private.account_is_active(r.recipient_id)
      and not private.users_are_blocked(r.sender_id, r.recipient_id)
  ));
drop policy if exists messages_insert_accepted_sender on public.messages;
create policy messages_insert_accepted_sender on public.messages for insert to authenticated with check (false);
drop policy if exists blocks_select_owner on public.user_blocks;
create policy blocks_select_owner on public.user_blocks for select to authenticated
  using (blocked_by = (select auth.uid()) and private.account_is_active((select auth.uid())));
drop policy if exists blocks_insert_owner on public.user_blocks;
create policy blocks_insert_owner on public.user_blocks for insert to authenticated
  with check (blocked_by = (select auth.uid()) and private.account_is_active((select auth.uid())));
drop policy if exists blocks_delete_owner on public.user_blocks;
create policy blocks_delete_owner on public.user_blocks for delete to authenticated
  using (blocked_by = (select auth.uid()) and private.account_is_active((select auth.uid())));
drop policy if exists reports_select_reporter on public.profile_reports;
create policy reports_select_reporter on public.profile_reports for select to authenticated
  using (reporter_id = (select auth.uid()) and private.account_is_active((select auth.uid())));
drop policy if exists reports_insert_reporter on public.profile_reports;
create policy reports_insert_reporter on public.profile_reports for insert to authenticated with check (false);
revoke insert on public.messages, public.profile_reports from authenticated;

-- The read grant must be both unblocked and for the profile's current object only.
create or replace function private.viewer_can_see_photo(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and private.account_is_active(auth.uid()) and (
    p_profile_id = auth.uid()
    or (not private.users_are_blocked(auth.uid(), p_profile_id) and exists (
      select 1 from private.profile_view_grants g
      join public.profiles p on p.id = g.profile_id and p.account_status = 'active'
      where g.viewer_id = auth.uid() and g.profile_id = p_profile_id and g.expires_at > now()
    ))
  );
$$;
revoke all on function private.viewer_can_see_photo(uuid) from public, anon;
grant execute on function private.viewer_can_see_photo(uuid) to authenticated;
drop policy if exists catchya_photo_read on storage.objects;
create policy catchya_photo_read on storage.objects for select to authenticated using (
  bucket_id = 'profile-photos'
  and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and private.viewer_can_see_photo(split_part(name, '/', 1)::uuid)
  and exists (select 1 from public.profiles p where p.id = split_part(name, '/', 1)::uuid and p.photo_path = name)
);

-- Stable client ids make retries idempotent after a timeout between commit and response.
alter table public.messages add column if not exists client_message_id uuid;
create unique index if not exists messages_client_idempotency_idx
  on public.messages(request_id, sender_id, client_message_id) where client_message_id is not null;

create or replace function public.my_account_state()
returns text language sql stable security definer set search_path = ''
as $$
  select p.account_status from public.profiles p where p.id = auth.uid();
$$;
create or replace function public.my_account_is_active()
returns boolean language sql stable security definer set search_path = ''
as $$ select private.account_is_active(auth.uid()); $$;

create or replace function public.complete_my_onboarding()
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not private.account_is_active(v_uid) then raise exception 'Active account required'; end if;
  update public.profiles set onboarding_completed = true, onboarding_step = 'complete', updated_at = now()
    where id = v_uid and length(trim(display_name)) > 0;
  return found;
end;
$$;
create or replace function public.set_my_onboarding_step(p_step text)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.account_is_active(auth.uid()) then raise exception 'Active account required'; end if;
  if p_step not in ('about_you', 'profile') then raise exception 'Invalid onboarding step'; end if;
  update public.profiles set onboarding_step = p_step, updated_at = now() where id = auth.uid() and not onboarding_completed;
  return found;
end;
$$;

-- The base migration defined this RPC as void; PostgreSQL requires DROP before a
-- function can change its return type. No database objects depend on this RPC.
drop function if exists public.reactivate_my_account();
create function public.reactivate_my_account()
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_state text;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select account_status into v_state from public.profiles where id = v_uid for update;
  if v_state = 'suspended' then raise exception 'This account is suspended. Contact CatchYa support.'; end if;
  if v_state = 'deactivated' then
    update public.profiles set account_status = 'active', updated_at = now() where id = v_uid;
  end if;
  return v_state in ('active', 'deactivated');
end;
$$;

create or replace function public.set_my_discovery(
  p_enabled boolean, p_duration text default '15 minutes',
  p_latitude double precision default null, p_longitude double precision default null
)
returns table(enabled boolean, duration text, expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_expiry timestamptz;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_enabled is null then raise exception 'Discovery choice must be explicit'; end if;
  if not p_enabled then
    update public.discovery_preferences d set enabled = false,
      duration = case when p_duration in ('15 minutes', '30 minutes', '1 hour') then p_duration else d.duration end,
      expires_at = null, updated_at = now() where d.user_id = v_uid;
    delete from private.discovery_locations l where l.user_id = v_uid;
    return query select false,
      coalesce((select d.duration from public.discovery_preferences d where d.user_id = v_uid), '15 minutes'),
      null::timestamptz;
    return;
  end if;
  if not private.account_is_active(v_uid) then raise exception 'Active account required'; end if;
  if p_duration not in ('15 minutes', '30 minutes', '1 hour') then raise exception 'Unsupported discovery duration'; end if;
  if p_latitude is null or p_longitude is null or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'A valid foreground location is required to enable discovery';
  end if;
  if not private.consume_rate_limit(v_uid, 'discovery-location-update', 30, interval '1 hour') then
    raise exception 'Too many location updates. Try again later';
  end if;
  v_expiry := now() + case p_duration when '15 minutes' then interval '15 minutes' when '30 minutes' then interval '30 minutes' else interval '1 hour' end;
  insert into public.discovery_preferences as d(user_id, enabled, duration, expires_at, updated_at)
  values (v_uid, true, p_duration, v_expiry, now())
  on conflict (user_id) do update set enabled = true, duration = excluded.duration, expires_at = excluded.expires_at, updated_at = now();
  insert into private.discovery_locations as l(user_id, latitude, longitude, expires_at, updated_at)
  values (v_uid, p_latitude, p_longitude, v_expiry, now())
  on conflict (user_id) do update set latitude = excluded.latitude, longitude = excluded.longitude, expires_at = excluded.expires_at, updated_at = now();
  return query select true, p_duration, v_expiry;
end;
$$;

create or replace function public.my_discovery_preferences()
returns table(enabled boolean, duration text, expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  update public.discovery_preferences d set enabled = false, expires_at = null, updated_at = now()
    where d.user_id = v_uid and d.enabled and d.expires_at is not null and d.expires_at <= now();
  delete from private.discovery_locations l where l.user_id = v_uid and l.expires_at is not null and l.expires_at <= now();
  return query select (d.enabled and private.account_is_active(v_uid)
      and (d.expires_at is null or d.expires_at > now())), d.duration,
      case when d.expires_at > now() then d.expires_at else null end
    from public.discovery_preferences d where d.user_id = v_uid;
end;
$$;

create or replace function public.respond_to_connection_request(p_request_id uuid, p_accept boolean)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_sender uuid; v_initial text;
begin
  if v_uid is null or not private.account_is_active(v_uid) then raise exception 'Active account required'; end if;
  select r.sender_id, r.initial_message into v_sender, v_initial from public.connection_requests r
    where r.id = p_request_id and r.recipient_id = v_uid and r.status = 'pending' for update;
  if v_sender is null then return false; end if;
  if not private.account_is_active(v_sender) or private.users_are_blocked(v_uid, v_sender) then raise exception 'This request is unavailable'; end if;
  update public.connection_requests set status = case when p_accept then 'accepted' else 'declined' end,
    responded_at = now(), recipient_read_at = now()
    where id = p_request_id and recipient_id = v_uid and status = 'pending';
  if p_accept and length(trim(coalesce(v_initial, ''))) > 0 then
    insert into public.messages(request_id, sender_id, body, client_message_id)
      values (p_request_id, v_sender, v_initial, p_request_id)
      on conflict (request_id, sender_id, client_message_id) where client_message_id is not null do nothing;
  end if;
  return found or p_accept;
end;
$$;

create or replace function public.set_conversation_hidden(p_request_id uuid, p_hidden boolean)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_other uuid; v_status text;
begin
  if v_uid is null or not private.account_is_active(v_uid) then raise exception 'Active account required'; end if;
  select case when r.sender_id = v_uid then r.recipient_id else r.sender_id end, r.status
    into v_other, v_status from public.connection_requests r
    where r.id = p_request_id and (r.sender_id = v_uid or r.recipient_id = v_uid);
  if v_other is null or private.users_are_blocked(v_uid, v_other) then return false; end if;
  if v_status not in ('accepted', 'pending') then return false; end if;
  if p_hidden then
    insert into public.conversation_user_state(request_id, user_id, hidden_at, updated_at)
      values (p_request_id, v_uid, now(), now())
      on conflict (request_id, user_id) do update set hidden_at = now(), updated_at = now();
  else
    update public.conversation_user_state set hidden_at = null, updated_at = now()
      where request_id = p_request_id and user_id = v_uid;
  end if;
  return true;
end;
$$;

-- Replace the legacy whole-inbox function with a stable keyset-paginated version.
drop function if exists public.my_inbox();
create function public.my_inbox(p_before_updated_at timestamptz default null, p_before_id uuid default null, p_limit integer default 30)
returns table(
  id uuid, profile_id uuid, display_name text, photo_path text, status text,
  first_message text, last_message text, updated_at timestamptz, unread_count integer, profile_preview jsonb
)
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not private.account_is_active(v_uid) then raise exception 'Active account required'; end if;
  if p_limit < 1 or p_limit > 100 then raise exception 'Page size must be between 1 and 100'; end if;
  insert into private.profile_view_grants(viewer_id, profile_id, expires_at)
  select v_uid, p.id, now() + interval '10 minutes' from public.connection_requests r
  join public.profiles p on p.id = case when r.sender_id = v_uid then r.recipient_id else r.sender_id end
  where (r.sender_id = v_uid or r.recipient_id = v_uid)
    and (r.status = 'accepted' or (r.status = 'pending' and r.recipient_id = v_uid))
    and p.account_status = 'active' and not private.users_are_blocked(v_uid, p.id)
  on conflict (viewer_id, profile_id) do update set expires_at = excluded.expires_at;
  return query
  select r.id, p.id, p.display_name, p.photo_path,
    case when r.status = 'accepted' then 'chat' else 'request' end,
    r.initial_message, coalesce(latest.body, r.initial_message, ''),
    coalesce(latest.created_at, r.responded_at, r.created_at),
    case when r.status = 'pending' then case when r.recipient_id = v_uid and r.recipient_read_at is null then 1 else 0 end
      else (select count(*)::integer from public.messages unread where unread.request_id = r.id
        and unread.sender_id <> v_uid and unread.created_at > coalesce(
          case when r.sender_id = v_uid then r.sender_read_at else r.recipient_read_at end, r.created_at)) end,
    jsonb_build_object('bio', p.bio, 'genderLabel', case when p.show_gender then
      case when p.gender = 'Self-describe' then nullif(p.gender_description, '')
        when p.gender = 'Prefer not to say' then null else p.gender end else null end)
  from public.connection_requests r
  join public.profiles p on p.id = case when r.sender_id = v_uid then r.recipient_id else r.sender_id end
  left join lateral (select m.body, m.created_at from public.messages m where m.request_id = r.id
    order by m.created_at desc, m.id desc limit 1) latest on true
  left join public.conversation_user_state s on s.request_id = r.id and s.user_id = v_uid
  where (r.status = 'accepted' or (r.status = 'pending' and r.recipient_id = v_uid))
    and (r.sender_id = v_uid or r.recipient_id = v_uid)
    and p.account_status = 'active' and not private.users_are_blocked(v_uid, p.id)
    and s.hidden_at is null
    and (p_before_updated_at is null or
      (coalesce(latest.created_at, r.responded_at, r.created_at), r.id) < (p_before_updated_at, p_before_id))
  order by coalesce(latest.created_at, r.responded_at, r.created_at) desc, r.id desc
  limit p_limit;
end;
$$;

create or replace function public.mark_conversation_read(p_request_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not private.account_is_active(v_uid) then raise exception 'Active account required'; end if;
  update public.connection_requests r set
    sender_read_at = case when r.sender_id = v_uid then now() else r.sender_read_at end,
    recipient_read_at = case when r.recipient_id = v_uid then now() else r.recipient_read_at end
  where r.id = p_request_id and (r.sender_id = v_uid or r.recipient_id = v_uid)
    and (r.status = 'accepted' or (r.status = 'pending' and r.recipient_id = v_uid))
    and not private.users_are_blocked(r.sender_id, r.recipient_id);
  return found;
end;
$$;

create or replace function public.list_conversation_messages(
  p_request_id uuid, p_before_created_at timestamptz default null, p_before_id uuid default null, p_limit integer default 50
)
returns table(id uuid, sender_id uuid, body text, created_at timestamptz, client_message_id uuid)
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not private.account_is_active(v_uid) then raise exception 'Active account required'; end if;
  if p_limit < 1 or p_limit > 100 then raise exception 'Page size must be between 1 and 100'; end if;
  if not exists(select 1 from public.connection_requests r where r.id = p_request_id and r.status = 'accepted'
    and (r.sender_id = v_uid or r.recipient_id = v_uid)
    and private.account_is_active(r.sender_id) and private.account_is_active(r.recipient_id)
    and not private.users_are_blocked(r.sender_id, r.recipient_id)) then
    raise exception 'Accepted conversation access required';
  end if;
  return query select m.id, m.sender_id, m.body, m.created_at, m.client_message_id
    from public.messages m where m.request_id = p_request_id and (p_before_created_at is null or
      (m.created_at, m.id) < (p_before_created_at, p_before_id))
    order by m.created_at desc, m.id desc limit p_limit;
end;
$$;

create or replace function public.send_chat_message(p_request_id uuid, p_client_message_id uuid, p_body text)
returns table(id uuid, sender_id uuid, body text, created_at timestamptz, client_message_id uuid)
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_row public.messages%rowtype;
begin
  if v_uid is null or not private.account_is_active(v_uid) then raise exception 'Active account required'; end if;
  if p_client_message_id is null then raise exception 'A message id is required'; end if;
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 2000 then raise exception 'Message must contain 1–2000 characters'; end if;
  if not private.consume_rate_limit(v_uid, 'messages', 40, interval '1 minute') then raise exception 'You are sending messages too quickly'; end if;
  if not exists(select 1 from public.connection_requests r where r.id = p_request_id and r.status = 'accepted'
    and (r.sender_id = v_uid or r.recipient_id = v_uid) and private.account_is_active(r.sender_id)
    and private.account_is_active(r.recipient_id) and not private.users_are_blocked(r.sender_id, r.recipient_id)) then
    raise exception 'Accepted conversation access required';
  end if;
  insert into public.messages(request_id, sender_id, body, client_message_id)
    values (p_request_id, v_uid, trim(p_body), p_client_message_id)
    on conflict do nothing;
  select * into v_row from public.messages m where m.request_id = p_request_id
    and m.sender_id = v_uid and m.client_message_id = p_client_message_id;
  if v_row.body is distinct from trim(p_body) then raise exception 'Message id was already used for different text'; end if;
  return query select v_row.id, v_row.sender_id, v_row.body, v_row.created_at, v_row.client_message_id;
end;
$$;

-- Request sends remain recipient-scoped and are rate-limited inside the trusted RPC.
create or replace function public.send_connection_request(p_recipient_id uuid, p_initial_message text default '')
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_inserted uuid;
begin
  if v_uid is null or not private.account_is_active(v_uid) then raise exception 'Active account required'; end if;
  if p_recipient_id is null or p_recipient_id = v_uid then raise exception 'Choose another profile'; end if;
  if char_length(coalesce(p_initial_message, '')) > 2000 then raise exception 'Message is too long'; end if;
  if private.users_are_blocked(v_uid, p_recipient_id) then raise exception 'This connection is unavailable'; end if;
  if not private.account_is_active(p_recipient_id) then raise exception 'This profile is unavailable'; end if;
  if not private.consume_rate_limit(v_uid, 'connection-requests', 10, interval '1 hour') then raise exception 'Too many requests. Try again later'; end if;
  insert into public.connection_requests(sender_id, recipient_id, initial_message)
    values (v_uid, p_recipient_id, coalesce(p_initial_message, ''))
    on conflict do nothing returning id into v_inserted;
  return v_inserted is not null;
end;
$$;

create or replace function public.report_profile(p_profile_id uuid, p_reason text default 'profile')
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_report uuid;
begin
  if v_uid is null or not private.account_is_active(v_uid) then raise exception 'Active account required'; end if;
  if p_profile_id is null or p_profile_id = v_uid then raise exception 'Choose another profile'; end if;
  if not private.account_is_active(p_profile_id) then raise exception 'Profile unavailable'; end if;
  if not private.consume_rate_limit(v_uid, 'profile-reports', 5, interval '1 day') then raise exception 'Report limit reached. Try again tomorrow'; end if;
  insert into public.profile_reports(reporter_id, reported_user, reason)
    values (v_uid, p_profile_id, left(coalesce(nullif(trim(p_reason), ''), 'profile'), 80)) returning id into v_report;
  return v_report;
end;
$$;

create or replace function public.set_profile_blocked(p_profile_id uuid, p_blocked boolean)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not private.account_is_active(v_uid) then raise exception 'Active account required'; end if;
  if p_profile_id is null or p_profile_id = v_uid then raise exception 'Choose another profile'; end if;
  if not exists(select 1 from public.profiles where id = p_profile_id) then return false; end if;
  if p_blocked then
    insert into public.user_blocks(blocked_by, blocked_user) values (v_uid, p_profile_id) on conflict do nothing;
    delete from private.profile_view_grants where (viewer_id = v_uid and profile_id = p_profile_id)
      or (viewer_id = p_profile_id and profile_id = v_uid);
    insert into public.conversation_user_state(request_id, user_id, hidden_at, updated_at)
      select r.id, v_uid, now(), now() from public.connection_requests r
      where (r.sender_id = v_uid and r.recipient_id = p_profile_id) or (r.sender_id = p_profile_id and r.recipient_id = v_uid)
      on conflict (request_id, user_id) do update set hidden_at = now(), updated_at = now();
  else
    delete from public.user_blocks where blocked_by = v_uid and blocked_user = p_profile_id;
  end if;
  return true;
end;
$$;

create or replace function public.my_profile_qr_token()
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_token uuid;
begin
  if auth.uid() is null or not private.account_is_active(auth.uid()) then raise exception 'Active account required'; end if;
  select p.qr_token into v_token from public.profiles p where p.id = auth.uid();
  return v_token;
end;
$$;

-- Moderator identities live only in the non-exposed schema. Provision by a trusted
-- administrator through the SQL Editor; never accept a client role claim.
create table if not exists private.moderator_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('moderator', 'admin')),
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);
create table if not exists private.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references public.profile_reports(id) on delete set null,
  actor_id uuid not null references auth.users(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('dismiss', 'warn', 'suspend', 'unsuspend')),
  note text not null default '' check (char_length(note) <= 1000),
  created_at timestamptz not null default now()
);
alter table private.moderator_roles enable row level security;
alter table private.moderation_actions enable row level security;
drop policy if exists moderator_roles_deny_client on private.moderator_roles;
create policy moderator_roles_deny_client on private.moderator_roles for all to anon, authenticated using (false) with check (false);
drop policy if exists moderation_actions_deny_client on private.moderation_actions;
create policy moderation_actions_deny_client on private.moderation_actions for all to anon, authenticated using (false) with check (false);
revoke all on private.moderator_roles, private.moderation_actions from public, anon, authenticated;

alter table public.profile_reports add column if not exists status text not null default 'open';
alter table public.profile_reports add column if not exists reviewed_by uuid references auth.users(id) on delete set null;
alter table public.profile_reports add column if not exists reviewed_at timestamptz;
alter table public.profile_reports drop constraint if exists profile_reports_status_check;
alter table public.profile_reports add constraint profile_reports_status_check check (status in ('open', 'resolved'));
create index if not exists profile_reports_queue_idx on public.profile_reports(status, created_at);

create or replace function private.is_active_moderator(p_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from private.moderator_roles r where r.user_id = p_user and r.revoked_at is null); $$;
revoke all on function private.is_active_moderator(uuid) from public, anon, authenticated;
grant execute on function private.is_active_moderator(uuid) to authenticated;

create or replace function public.moderation_report_queue(p_limit integer default 50)
returns table(id uuid, reporter_id uuid, reported_user uuid, reason text, created_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_active_moderator(auth.uid()) then raise exception 'Moderator access required'; end if;
  if not private.account_is_active(auth.uid()) then raise exception 'Active account required'; end if;
  return query select r.id, r.reporter_id, r.reported_user, r.reason, r.created_at
    from public.profile_reports r where r.status = 'open' order by r.created_at asc limit greatest(1, least(p_limit, 100));
end;
$$;

create or replace function public.moderate_profile_report(p_report_id uuid, p_action text, p_note text default '')
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_target uuid; v_status text;
begin
  if v_actor is null or not private.account_is_active(v_actor) or not private.is_active_moderator(v_actor) then raise exception 'Moderator access required'; end if;
  if p_action not in ('dismiss', 'warn', 'suspend') then raise exception 'Unsupported moderation action'; end if;
  select r.reported_user, r.status into v_target, v_status from public.profile_reports r where r.id = p_report_id for update;
  if v_target is null or v_status <> 'open' then return false; end if;
  update public.profile_reports set status = 'resolved', reviewed_by = v_actor, reviewed_at = now() where id = p_report_id;
  insert into private.moderation_actions(report_id, actor_id, target_user_id, action, note)
    values (p_report_id, v_actor, v_target, p_action, left(coalesce(p_note, ''), 1000));
  if p_action = 'suspend' then
    update public.profiles set account_status = 'suspended', suspended_at = now(),
      suspension_reason = left(coalesce(p_note, 'Policy review'), 500), updated_at = now() where id = v_target;
    update public.discovery_preferences set enabled = false, expires_at = null, updated_at = now() where user_id = v_target;
    delete from private.discovery_locations where user_id = v_target;
    update public.push_devices set enabled = false, updated_at = now() where user_id = v_target;
  end if;
  return true;
end;
$$;

create or replace function public.moderate_account_status(p_target_user uuid, p_action text, p_note text default '')
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or not private.account_is_active(v_actor) or not private.is_active_moderator(v_actor) then raise exception 'Moderator access required'; end if;
  if p_action not in ('suspend', 'unsuspend') or p_target_user = v_actor then raise exception 'Unsupported account action'; end if;
  if p_action = 'suspend' then
    update public.profiles set account_status = 'suspended', suspended_at = now(), suspension_reason = left(coalesce(p_note, 'Policy review'), 500), updated_at = now()
      where id = p_target_user and account_status = 'active';
  else
    update public.profiles set account_status = 'active', suspended_at = null, suspension_reason = null, updated_at = now()
      where id = p_target_user and account_status = 'suspended';
  end if;
  if not found then return false; end if;
  insert into private.moderation_actions(actor_id, target_user_id, action, note)
    values (v_actor, p_target_user, p_action, left(coalesce(p_note, ''), 1000));
  if p_action = 'suspend' then
    update public.discovery_preferences set enabled = false, expires_at = null, updated_at = now() where user_id = p_target_user;
    delete from private.discovery_locations where user_id = p_target_user;
    update public.push_devices set enabled = false, updated_at = now() where user_id = p_target_user;
  end if;
  return true;
end;
$$;

create or replace function public.enqueue_request_notification()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    insert into public.notification_outbox(event_key, recipient_id, request_id, kind)
      values ('request:' || new.id::text, new.recipient_id, new.id, 'request') on conflict(event_key) do nothing;
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    insert into public.notification_outbox(event_key, recipient_id, request_id, kind)
      values ('accepted:' || new.id::text, new.sender_id, new.id, 'accepted') on conflict(event_key) do nothing;
  end if;
  return new;
end;
$$;
create or replace function public.enqueue_message_notification()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_recipient uuid;
begin
  if new.client_message_id = new.request_id then return new; end if;
  select case when r.sender_id = new.sender_id then r.recipient_id else r.sender_id end into v_recipient
    from public.connection_requests r where r.id = new.request_id and r.status = 'accepted';
  if v_recipient is not null then
    insert into public.notification_outbox(event_key, recipient_id, request_id, kind)
      values ('message:' || new.id::text, v_recipient, new.request_id, 'message') on conflict(event_key) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.enqueue_request_notification() from public, anon, authenticated;
revoke all on function public.enqueue_message_notification() from public, anon, authenticated;
drop trigger if exists catchya_request_notification on public.connection_requests;
create trigger catchya_request_notification after insert or update of status on public.connection_requests
  for each row execute function public.enqueue_request_notification();
drop trigger if exists catchya_message_notification on public.messages;
create trigger catchya_message_notification after insert on public.messages
  for each row execute function public.enqueue_message_notification();

-- Database-clock expiry is strict for reads; pg_cron performs physical cleanup every minute.
create or replace function private.cleanup_expired_catchya_data()
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_count integer := 0; v_rows integer;
begin
  update public.discovery_preferences set enabled = false, expires_at = null, updated_at = now()
    where enabled and expires_at is not null and expires_at <= now();
  get diagnostics v_rows = row_count; v_count := v_count + v_rows;
  delete from private.discovery_locations where expires_at is not null and expires_at <= now();
  get diagnostics v_rows = row_count; v_count := v_count + v_rows;
  delete from private.profile_view_grants where expires_at <= now();
  get diagnostics v_rows = row_count; v_count := v_count + v_rows;
  delete from private.rate_limit_counters where window_start < now() - interval '2 days';
  get diagnostics v_rows = row_count; v_count := v_count + v_rows;
  update public.notification_outbox set status = 'queued', locked_until = null
    where status = 'processing' and locked_until < now();
  return v_count;
end;
$$;
revoke all on function private.cleanup_expired_catchya_data() from public, anon, authenticated;
grant execute on function private.cleanup_expired_catchya_data() to service_role;
do $$
begin
  if exists(select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
    if to_regnamespace('cron') is not null then
      if exists(select 1 from cron.job where jobname = 'catchya-expire-private-data') then
        perform cron.unschedule(jobid) from cron.job where jobname = 'catchya-expire-private-data';
      end if;
      perform cron.schedule('catchya-expire-private-data', '* * * * *', 'select private.cleanup_expired_catchya_data()');
    else
      raise exception 'pg_cron is installed but cron schema is missing; schedule private-data cleanup before enabling discovery';
    end if;
  else
    raise exception 'pg_cron is required for automatic expiry cleanup; enable it before applying CatchYa migrations';
  end if;
end;
$$;

-- Explicit API grants: clients can request lifecycle actions, never inspect tokens or moderation.
revoke all on function public.my_account_state() from public, anon;
revoke all on function public.complete_my_onboarding() from public, anon;
revoke all on function public.set_my_onboarding_step(text) from public, anon;
revoke all on function public.set_conversation_hidden(uuid, boolean) from public, anon;
revoke all on function public.my_inbox(timestamptz, uuid, integer) from public, anon;
revoke all on function public.list_conversation_messages(uuid, timestamptz, uuid, integer) from public, anon;
revoke all on function public.send_chat_message(uuid, uuid, text) from public, anon;
revoke all on function public.moderation_report_queue(integer) from public, anon;
revoke all on function public.moderate_profile_report(uuid, text, text) from public, anon;
revoke all on function public.moderate_account_status(uuid, text, text) from public, anon;
revoke all on function public.reactivate_my_account() from public, anon;
grant execute on function public.my_account_state() to authenticated;
grant execute on function public.my_account_is_active() to authenticated;
grant execute on function public.complete_my_onboarding() to authenticated;
grant execute on function public.set_my_onboarding_step(text) to authenticated;
grant execute on function public.set_my_discovery(boolean, text, double precision, double precision) to authenticated;
grant execute on function public.my_discovery_preferences() to authenticated;
grant execute on function public.respond_to_connection_request(uuid, boolean) to authenticated;
grant execute on function public.send_connection_request(uuid, text) to authenticated;
grant execute on function public.set_conversation_hidden(uuid, boolean) to authenticated;
grant execute on function public.my_inbox(timestamptz, uuid, integer) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.list_conversation_messages(uuid, timestamptz, uuid, integer) to authenticated;
grant execute on function public.send_chat_message(uuid, uuid, text) to authenticated;
grant execute on function public.report_profile(uuid, text) to authenticated;
grant execute on function public.set_profile_blocked(uuid, boolean) to authenticated;
grant execute on function public.moderation_report_queue(integer) to authenticated;
grant execute on function public.moderate_profile_report(uuid, text, text) to authenticated;
grant execute on function public.moderate_account_status(uuid, text, text) to authenticated;
grant execute on function public.reactivate_my_account() to authenticated;
