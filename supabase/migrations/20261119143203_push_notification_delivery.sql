-- Device tokens and delivery state are server-only. No client can read either.
create table public.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null references auth.sessions(id) on delete cascade,
  installation_id uuid not null unique,
  expo_push_token text not null unique check (expo_push_token ~ '^(Expo|Exponent)PushToken\[[A-Za-z0-9_:-]+\]$'),
  platform text not null check (platform in ('ios', 'android')),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
create index push_devices_user_idx on public.push_devices(user_id);
create index push_devices_session_idx on public.push_devices(session_id);

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null references public.connection_requests(id) on delete cascade,
  kind text not null check (kind in ('request', 'accepted', 'message')),
  created_at timestamptz not null default now()
);
create index notification_outbox_recipient_idx on public.notification_outbox(recipient_id);
create index notification_outbox_request_idx on public.notification_outbox(request_id);
create index notification_outbox_created_idx on public.notification_outbox(created_at);

create table public.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references public.notification_outbox(id) on delete cascade,
  device_id uuid not null references public.push_devices(id) on delete cascade,
  status text not null default 'queued' check (status in
    ('queued', 'processing', 'retry', 'ticketed', 'checking', 'delivered', 'invalid', 'suppressed', 'failed', 'unknown')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  lease_token uuid,
  token_snapshot text,
  ticket_id text,
  ticket_at timestamptz,
  last_error text,
  unique (outbox_id, device_id)
);
create index push_deliveries_due_idx on public.push_deliveries(status, next_attempt_at);
create index push_deliveries_device_idx on public.push_deliveries(device_id);
alter table public.push_devices enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.push_deliveries enable row level security;
revoke all on public.push_devices, public.notification_outbox, public.push_deliveries from public, anon, authenticated;
grant all on public.push_devices, public.notification_outbox, public.push_deliveries to service_role;

-- Called only after the Edge Function verifies the caller and its JWT session_id.
create function public.register_push_device(
  p_user_id uuid, p_session_id uuid, p_installation_id uuid, p_token text, p_platform text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.profiles where id = p_user_id and account_status = 'active')
    or not exists (select 1 from auth.sessions where id = p_session_id and user_id = p_user_id
      and (not_after is null or not_after > now())) then
    raise exception 'An active account session is required';
  end if;
  if p_installation_id is null or p_token is null or p_platform is null
    or p_token !~ '^(Expo|Exponent)PushToken\[[A-Za-z0-9_:-]+\]$'
    or length(p_token) > 256 or p_platform not in ('ios', 'android') then
    raise exception 'Invalid device registration';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_installation_id::text, 0));
  -- Reinstall/account switching must not leave a token attached to two accounts.
  delete from public.push_devices where expo_push_token = p_token and installation_id <> p_installation_id;
  insert into public.push_devices(user_id, session_id, installation_id, expo_push_token, platform)
    values (p_user_id, p_session_id, p_installation_id, p_token, p_platform)
    on conflict (installation_id) do update set user_id = excluded.user_id,
      session_id = excluded.session_id, expo_push_token = excluded.expo_push_token,
      platform = excluded.platform, enabled = true, updated_at = now()
    returning id into v_id;
  return v_id;
end;
$$;

-- Re-check preferences, both participants, blocks, the current device owner and
-- its Auth session at send time, including when unregistering failed offline.
create function private.push_delivery_allowed(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.push_deliveries delivery
    join public.notification_outbox event on event.id = delivery.outbox_id
    join public.push_devices device on device.id = delivery.device_id and device.user_id = event.recipient_id and device.enabled
    join auth.sessions session on session.id = device.session_id and session.user_id = device.user_id
      and (session.not_after is null or session.not_after > now())
    join public.user_preferences pref on pref.user_id = event.recipient_id and pref.notifications_enabled
    join public.connection_requests request on request.id = event.request_id
      and event.recipient_id in (request.sender_id, request.recipient_id)
    join public.profiles sender on sender.id = request.sender_id and sender.account_status = 'active'
    join public.profiles recipient on recipient.id = request.recipient_id and recipient.account_status = 'active'
    where delivery.id = p_id and event.created_at > now() - interval '1 hour'
      and ((event.kind = 'request' and request.status = 'pending' and event.recipient_id = request.recipient_id)
        or (event.kind in ('accepted', 'message') and request.status = 'accepted'))
      -- The existing viewer-scoped block helper requires auth.uid(); a server
      -- worker has no end-user claim, so check both block directions directly.
      and not exists (select 1 from public.user_blocks block
        where (block.blocked_by = request.sender_id and block.blocked_user = request.recipient_id)
          or (block.blocked_by = request.recipient_id and block.blocked_user = request.sender_id))
  );
$$;

create function private.enqueue_push_event(p_event_key text, p_recipient uuid, p_request uuid, p_kind text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_event uuid;
begin
  if not exists (select 1 from public.user_preferences where user_id = p_recipient and notifications_enabled) then return; end if;
  insert into public.notification_outbox(event_key, recipient_id, request_id, kind)
    values (p_event_key, p_recipient, p_request, p_kind)
    on conflict (event_key) do nothing returning id into v_event;
  if v_event is null then return; end if;
  insert into public.push_deliveries(outbox_id, device_id)
    select v_event, id from public.push_devices where user_id = p_recipient and enabled;
end;
$$;

create function private.enqueue_connection_push()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'pending' then
      perform private.enqueue_push_event('request:' || new.id, new.recipient_id, new.id, 'request');
    end if;
  elsif old.status = 'pending' and new.status = 'accepted' then
    perform private.enqueue_push_event('accepted:' || new.id, new.sender_id, new.id, 'accepted');
  end if;
  return new;
end;
$$;

create function private.enqueue_message_push()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_recipient uuid;
begin
  select case when sender_id = new.sender_id then recipient_id else sender_id end into v_recipient
    from public.connection_requests where id = new.request_id and status = 'accepted'
      and new.sender_id in (sender_id, recipient_id);
  if v_recipient is not null then
    perform private.enqueue_push_event('message:' || new.id, v_recipient, new.request_id, 'message');
  end if;
  return new;
end;
$$;
create trigger crossa_connection_push after insert or update of status on public.connection_requests
  for each row execute function private.enqueue_connection_push();
create trigger crossa_message_push after insert on public.messages
  for each row execute function private.enqueue_message_push();

-- Atomic claims with SKIP LOCKED let scheduled workers overlap safely.
create function public.claim_push_deliveries(p_limit integer default 25)
returns table(id uuid, lease_token uuid, token text, recipient_id uuid, request_id uuid, kind text, attempts integer)
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.notification_outbox where created_at < now() - interval '7 days';
  update public.push_deliveries d set status = 'suppressed', locked_until = null, lease_token = null
    where (d.status in ('queued', 'retry') or (d.status = 'processing' and d.locked_until <= now()))
      and not private.push_delivery_allowed(d.id);
  update public.push_deliveries d set status = 'failed', locked_until = null, lease_token = null
    where (d.status in ('queued', 'retry') or (d.status = 'processing' and d.locked_until <= now())) and d.attempts >= 8;
  return query
    with candidates as (
      select d.id from public.push_deliveries d
      where ((d.status in ('queued', 'retry') and d.next_attempt_at <= now())
        or (d.status = 'processing' and d.locked_until <= now()))
        and d.attempts < 8 and private.push_delivery_allowed(d.id)
      order by d.next_attempt_at, d.id for update skip locked limit greatest(1, least(p_limit, 100))
    ), claimed as (
      update public.push_deliveries d set status = 'processing', attempts = d.attempts + 1,
        lease_token = gen_random_uuid(), locked_until = now() + interval '90 seconds',
        token_snapshot = device.expo_push_token
      from candidates c, public.push_devices device where d.id = c.id and device.id = d.device_id returning d.*
    )
    select c.id, c.lease_token, c.token_snapshot, e.recipient_id, e.request_id, e.kind, c.attempts
      from claimed c join public.notification_outbox e on e.id = c.outbox_id;
end;
$$;

create function public.push_delivery_still_allowed(p_id uuid, p_lease uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.push_deliveries d join public.push_devices device on device.id = d.device_id
    where d.id = p_id and d.lease_token = p_lease and d.status = 'processing' and d.locked_until > now()
      and d.token_snapshot = device.expo_push_token and private.push_delivery_allowed(d.id));
$$;

create function public.claim_push_receipts(p_limit integer default 100)
returns table(id uuid, lease_token uuid, ticket_id text, ticket_at timestamptz)
language sql security definer set search_path = '' as $$
  with candidates as (
    select d.id from public.push_deliveries d where d.ticket_id is not null
      and ((d.status = 'ticketed' and d.next_attempt_at <= now()) or (d.status = 'checking' and d.locked_until <= now()))
    order by d.next_attempt_at for update skip locked limit greatest(1, least(p_limit, 300))
  ), claimed as (
    update public.push_deliveries d set status = 'checking', lease_token = gen_random_uuid(),
      locked_until = now() + interval '90 seconds' from candidates c where d.id = c.id returning d.*
  ) select id, lease_token, ticket_id, ticket_at from claimed;
$$;

-- Every completion carries the claim's lease. An expired worker cannot overwrite
-- the result of a newer claim. Receipt invalidation affects only its old token.
create function public.finish_push_delivery(
  p_id uuid, p_lease uuid, p_status text, p_ticket text default null, p_error text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_delivery public.push_deliveries; v_status text := p_status;
begin
  select * into v_delivery from public.push_deliveries where id = p_id and lease_token = p_lease
    and status in ('processing', 'checking') and locked_until > now() for update;
  if not found then return false; end if;
  if p_status not in ('retry', 'ticketed', 'delivered', 'invalid', 'suppressed', 'failed', 'unknown') then
    raise exception 'Invalid delivery outcome';
  end if;
  if v_status = 'retry' and v_delivery.attempts >= 8 then v_status := 'failed'; end if;
  if v_status = 'ticketed' and coalesce(p_ticket, v_delivery.ticket_id) is null then
    raise exception 'A successful Expo ticket is required';
  end if;
  if v_status = 'invalid' then
    update public.push_devices set enabled = false, updated_at = now()
      where id = v_delivery.device_id and expo_push_token = v_delivery.token_snapshot;
  end if;
  update public.push_deliveries set status = v_status, locked_until = null, lease_token = null,
    ticket_id = case when v_status = 'ticketed' then coalesce(p_ticket, v_delivery.ticket_id) else null end,
    ticket_at = case when v_status = 'ticketed' then coalesce(v_delivery.ticket_at, now()) else null end,
    next_attempt_at = case when v_status = 'ticketed' then now() + interval '15 minutes'
      when v_status = 'retry' then now() + make_interval(secs => least(3600, 30 * power(2, greatest(0, v_delivery.attempts - 1)))::integer)
      else now() end,
    last_error = left(p_error, 300)
    where id = p_id and lease_token = p_lease;
  return true;
end;
$$;

revoke all on function private.push_delivery_allowed(uuid) from public, anon, authenticated;
revoke all on function private.enqueue_push_event(text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.enqueue_connection_push() from public, anon, authenticated;
revoke all on function private.enqueue_message_push() from public, anon, authenticated;
revoke all on function public.register_push_device(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.claim_push_deliveries(integer) from public, anon, authenticated;
revoke all on function public.push_delivery_still_allowed(uuid, uuid) from public, anon, authenticated;
revoke all on function public.claim_push_receipts(integer) from public, anon, authenticated;
revoke all on function public.finish_push_delivery(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.register_push_device(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.claim_push_deliveries(integer) to service_role;
grant execute on function public.push_delivery_still_allowed(uuid, uuid) to service_role;
grant execute on function public.claim_push_receipts(integer) to service_role;
grant execute on function public.finish_push_delivery(uuid, uuid, text, text, text) to service_role;
