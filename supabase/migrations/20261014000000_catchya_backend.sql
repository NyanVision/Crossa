-- CatchYa backend schema. Exact coordinates are kept in a non-exposed schema and
-- never appear in any user-facing RPC result. All user-facing table access is
-- constrained by RLS and explicit grants.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to postgres, service_role;
grant usage on schema private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 40),
  age smallint check (age is null or age between 13 and 120),
  photo_path text,
  bio text not null default '' check (char_length(bio) <= 120),
  gender text check (gender is null or gender in ('Woman', 'Man', 'Non-binary', 'Self-describe', 'Prefer not to say')),
  gender_description text not null default '' check (char_length(gender_description) <= 48),
  show_gender boolean not null default false,
  meet_preferences text[] not null default '{}',
  account_status text not null default 'active' check (account_status in ('active', 'deactivated')),
  qr_token uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_photo_path_owned check (photo_path is null or split_part(photo_path, '/', 1) = id::text),
  constraint valid_meet_preferences check (
    meet_preferences <@ array['Women', 'Men', 'Non-binary people', 'Everyone']::text[]
  ),
  constraint gender_description_only_for_self_describe check (
    gender is not distinct from 'Self-describe' or gender_description = ''
  ),
  constraint visible_gender_has_value check (
    not show_gender or (gender is not null and gender <> 'Prefer not to say'
      and (gender <> 'Self-describe' or length(trim(gender_description)) > 0))
  )
);

create table public.profile_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('facebook', 'telegram', 'x', 'tiktok', 'instagram', 'line', 'whatsapp', 'wechat')),
  handle text not null check (char_length(trim(handle)) between 1 and 256),
  visible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, platform)
);

create table public.user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  appearance text not null default 'system' check (appearance in ('light', 'dark', 'system')),
  notifications_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.discovery_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default false,
  duration text not null default '15 minutes' check (duration in ('15 minutes', '1 hour', 'Until I turn it off')),
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint discovery_expiry_matches_duration check (
    (not enabled and expires_at is null)
    or (enabled and duration = 'Until I turn it off' and expires_at is null)
    or (enabled and duration = '15 minutes' and expires_at is not null)
    or (enabled and duration = '1 hour' and expires_at is not null)
  )
);

create table public.connection_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  initial_message text not null default '' check (char_length(initial_message) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  sender_read_at timestamptz,
  recipient_read_at timestamptz,
  constraint connection_request_not_self check (sender_id <> recipient_id)
);
create unique index connection_requests_active_pair_idx
  on public.connection_requests (least(sender_id, recipient_id), greatest(sender_id, recipient_id))
  where status in ('pending', 'accepted');
create index connection_requests_sender_idx on public.connection_requests(sender_id, created_at desc);
create index connection_requests_recipient_idx on public.connection_requests(recipient_id, created_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.connection_requests(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index messages_request_created_idx on public.messages(request_id, created_at desc);

create table public.user_blocks (
  blocked_by uuid not null references public.profiles(id) on delete cascade,
  blocked_user uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocked_by, blocked_user),
  constraint cannot_block_self check (blocked_by <> blocked_user)
);
create index user_blocks_target_idx on public.user_blocks(blocked_user, blocked_by);

create table public.profile_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_user uuid not null references public.profiles(id) on delete cascade,
  reason text not null default 'profile' check (char_length(reason) <= 80),
  created_at timestamptz not null default now(),
  constraint cannot_report_self check (reporter_id <> reported_user)
);

create table private.discovery_locations (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);
comment on table private.discovery_locations is
  'Exact coordinates; not in an exposed API schema. Deleted on opt-out and by expiry cleanup.';

create table private.profile_view_grants (
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null,
  primary key (viewer_id, profile_id)
);
create index profile_view_grants_expiry_idx on private.profile_view_grants(expires_at);

-- RLS is enabled on every app-owned table, including the internal tables.
alter table public.profiles enable row level security;
alter table public.profile_links enable row level security;
alter table public.user_preferences enable row level security;
alter table public.discovery_preferences enable row level security;
alter table public.connection_requests enable row level security;
alter table public.messages enable row level security;
alter table public.user_blocks enable row level security;
alter table public.profile_reports enable row level security;
alter table private.discovery_locations enable row level security;
alter table private.profile_view_grants enable row level security;

-- Private tables have explicit deny-all policies for authenticated clients;
-- carefully scoped owner-executed SECURITY DEFINER functions manage these rows.
create policy discovery_locations_deny_client on private.discovery_locations
  for all to authenticated using (false) with check (false);
create policy profile_view_grants_deny_client on private.profile_view_grants
  for all to authenticated using (false) with check (false);

-- Internal tables are accessible only inside carefully scoped SECURITY DEFINER functions.
revoke all on private.discovery_locations, private.profile_view_grants from public, anon, authenticated;

create or replace function private.users_are_blocked(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (p_a = auth.uid() or p_b = auth.uid()) and exists (
    select 1 from public.user_blocks b
    where (b.blocked_by = p_a and b.blocked_user = p_b)
       or (b.blocked_by = p_b and b.blocked_user = p_a)
  );
$$;

create or replace function private.viewer_can_see_photo(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    p_profile_id = auth.uid()
    or exists (
      select 1
      from private.profile_view_grants g
      join public.profiles p on p.id = g.profile_id and p.account_status = 'active'
      where g.viewer_id = auth.uid()
        and g.profile_id = p_profile_id
        and g.expires_at > now()
    )
  );
$$;

grant execute on function private.users_are_blocked(uuid, uuid) to authenticated;
grant execute on function private.viewer_can_see_photo(uuid) to authenticated;

-- Profiles and private preferences are owner-only in direct table access. Safe public
-- profile fields are returned only by the discovery and QR RPCs below.
create policy profiles_select_own on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles
  for update to authenticated using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
create policy profile_links_select_own on public.profile_links
  for select to authenticated using ((select auth.uid()) = user_id);
create policy profile_links_insert_own on public.profile_links
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy profile_links_update_own on public.profile_links
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy profile_links_delete_own on public.profile_links
  for delete to authenticated using ((select auth.uid()) = user_id);
create policy user_preferences_select_own on public.user_preferences
  for select to authenticated using ((select auth.uid()) = user_id);
create policy user_preferences_update_own on public.user_preferences
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy discovery_preferences_select_own on public.discovery_preferences
  for select to authenticated using ((select auth.uid()) = user_id);
create policy requests_select_participant on public.connection_requests
  for select to authenticated using (
    (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()))
    and not private.users_are_blocked(sender_id, recipient_id)
  );
create policy messages_select_accepted_participant on public.messages
  for select to authenticated using (
    exists (
      select 1 from public.connection_requests r
      where r.id = request_id and r.status = 'accepted'
        and (r.sender_id = (select auth.uid()) or r.recipient_id = (select auth.uid()))
        and not private.users_are_blocked(r.sender_id, r.recipient_id)
    )
  );
create policy messages_insert_accepted_sender on public.messages
  for insert to authenticated with check (
    sender_id = (select auth.uid())
    and exists (
      select 1 from public.connection_requests r
      where r.id = request_id and r.status = 'accepted'
        and (r.sender_id = (select auth.uid()) or r.recipient_id = (select auth.uid()))
        and not private.users_are_blocked(r.sender_id, r.recipient_id)
    )
  );
create policy blocks_select_owner on public.user_blocks
  for select to authenticated using (blocked_by = (select auth.uid()));
create policy blocks_insert_owner on public.user_blocks
  for insert to authenticated with check (blocked_by = (select auth.uid()));
create policy blocks_delete_owner on public.user_blocks
  for delete to authenticated using (blocked_by = (select auth.uid()));
create policy reports_select_reporter on public.profile_reports
  for select to authenticated using (reporter_id = (select auth.uid()));
create policy reports_insert_reporter on public.profile_reports
  for insert to authenticated with check (
    reporter_id = (select auth.uid()) and reporter_id <> reported_user
  );

-- Grant only the operations each screen needs. Account state and QR token cannot be
-- changed through table writes; discovery and request transitions use RPCs.
revoke all on public.profiles, public.profile_links, public.user_preferences,
  public.discovery_preferences, public.connection_requests, public.messages,
  public.user_blocks, public.profile_reports from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, age, photo_path, bio, gender, gender_description,
  show_gender, meet_preferences, updated_at) on public.profiles to authenticated;
grant select, insert, update, delete on public.profile_links to authenticated;
grant select on public.user_preferences to authenticated;
grant update (appearance, notifications_enabled, updated_at) on public.user_preferences to authenticated;
grant select on public.discovery_preferences to authenticated;
grant select on public.connection_requests to authenticated;
grant select, insert on public.messages to authenticated;
grant select, insert, delete on public.user_blocks to authenticated;
grant select, insert on public.profile_reports to authenticated;

create or replace function public.handle_new_catchya_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), 40)
  ) on conflict (id) do nothing;
  insert into public.user_preferences (user_id) values (new.id) on conflict (user_id) do nothing;
  insert into public.discovery_preferences (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_catchya_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_catchya on auth.users;
create trigger on_auth_user_created_catchya
after insert on auth.users
for each row execute function public.handle_new_catchya_user();

create or replace function public.set_my_discovery(
  p_enabled boolean,
  p_duration text default '15 minutes',
  p_latitude double precision default null,
  p_longitude double precision default null
)
returns table(enabled boolean, duration text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_expiry timestamptz;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not p_enabled then
    update public.discovery_preferences d
      set enabled = false,
          duration = case when p_duration in ('15 minutes', '1 hour', 'Until I turn it off') then p_duration else d.duration end,
          expires_at = null, updated_at = now()
      where d.user_id = v_user_id;
    delete from private.discovery_locations l where l.user_id = v_user_id;
    return query select false, coalesce((select d.duration from public.discovery_preferences d where d.user_id = v_user_id), '15 minutes'), null::timestamptz;
    return;
  end if;
  if p_duration not in ('15 minutes', '1 hour', 'Until I turn it off') then
    raise exception 'Unsupported discovery duration';
  end if;
  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'A valid foreground location is required to enable discovery';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_user_id and p.account_status = 'active') then
    raise exception 'Active account required';
  end if;
  v_expiry := case p_duration
    when '15 minutes' then now() + interval '15 minutes'
    when '1 hour' then now() + interval '1 hour'
    else null
  end;
  insert into public.discovery_preferences as d (user_id, enabled, duration, expires_at, updated_at)
  values (v_user_id, true, p_duration, v_expiry, now())
  on conflict (user_id) do update set enabled = true, duration = excluded.duration,
    expires_at = excluded.expires_at, updated_at = now();
  insert into private.discovery_locations as l (user_id, latitude, longitude, expires_at, updated_at)
  values (v_user_id, p_latitude, p_longitude, v_expiry, now())
  on conflict (user_id) do update set latitude = excluded.latitude, longitude = excluded.longitude,
    expires_at = excluded.expires_at, updated_at = now();
  return query select true, p_duration, v_expiry;
end;
$$;

create or replace function public.my_discovery_preferences()
returns table(enabled boolean, duration text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  update public.discovery_preferences d set enabled = false, expires_at = null, updated_at = now()
    where d.user_id = v_user_id and d.enabled and d.expires_at is not null and d.expires_at <= now();
  delete from private.discovery_locations l where l.user_id = v_user_id
    and l.expires_at is not null and l.expires_at <= now();
  return query select d.enabled, d.duration, d.expires_at
    from public.discovery_preferences d where d.user_id = v_user_id;
end;
$$;

create or replace function private.gender_category(p_gender text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_gender
    when 'Woman' then 'Women'
    when 'Man' then 'Men'
    when 'Non-binary' then 'Non-binary people'
    else null
  end;
$$;

create or replace function public.nearby_profiles(
  p_latitude double precision,
  p_longitude double precision,
  p_radius_m integer default 10000
)
returns table(
  profile_id uuid,
  display_name text,
  age smallint,
  photo_path text,
  bio text,
  gender_label text,
  social_links jsonb,
  distance_range text,
  interests text[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'A valid foreground location is required';
  end if;
  if p_radius_m is null or p_radius_m < 100 or p_radius_m > 10000 then
    raise exception 'Search radius must be between 100 and 10000 meters';
  end if;
  perform 1 from public.my_discovery_preferences() d where d.enabled;
  if not found then raise exception 'Turn on nearby discovery before scanning'; end if;
  update private.discovery_locations l
    set latitude = p_latitude, longitude = p_longitude, updated_at = now()
    where l.user_id = v_user_id
      and (l.expires_at is null or l.expires_at > now());
  if not found then raise exception 'Your discovery session is no longer active'; end if;

  insert into private.profile_view_grants(viewer_id, profile_id, expires_at)
  select v_user_id, candidate.id, now() + interval '10 minutes'
  from public.profiles candidate
  join public.discovery_preferences candidate_pref on candidate_pref.user_id = candidate.id and candidate_pref.enabled
  join private.discovery_locations loc on loc.user_id = candidate.id
  join public.profiles viewer on viewer.id = v_user_id and viewer.account_status = 'active'
  where candidate.id <> v_user_id and candidate.account_status = 'active'
    and (candidate_pref.expires_at is null or candidate_pref.expires_at > now())
    and (loc.expires_at is null or loc.expires_at > now())
    and not private.users_are_blocked(v_user_id, candidate.id)
    and (
      coalesce(cardinality(viewer.meet_preferences), 0) = 0
      or 'Everyone' = any(viewer.meet_preferences)
      or private.gender_category(candidate.gender) = any(viewer.meet_preferences)
    )
    and (
      coalesce(cardinality(candidate.meet_preferences), 0) = 0
      or 'Everyone' = any(candidate.meet_preferences)
      or private.gender_category(viewer.gender) = any(candidate.meet_preferences)
    )
    and 6371000 * 2 * asin(sqrt(least(1.0,
      power(sin(radians(loc.latitude - p_latitude) / 2), 2)
      + cos(radians(p_latitude)) * cos(radians(loc.latitude))
        * power(sin(radians(loc.longitude - p_longitude) / 2), 2)
    ))) <= p_radius_m
  on conflict (viewer_id, profile_id) do update set expires_at = excluded.expires_at;

  return query
  select candidate.id,
    candidate.display_name,
    candidate.age,
    candidate.photo_path,
    candidate.bio,
    case when candidate.show_gender then
      case when candidate.gender = 'Self-describe' then nullif(candidate.gender_description, '')
        when candidate.gender = 'Prefer not to say' then null else candidate.gender end
      else null end,
    coalesce((
      select jsonb_agg(jsonb_build_object('platform', link.platform, 'value', link.handle, 'visible', true)
        order by link.platform)
      from public.profile_links link where link.user_id = candidate.id and link.visible
    ), '[]'::jsonb),
    case when d.meters < 1000 then 'Within 1 km'
      when d.meters < 3000 then '1–3 km'
      when d.meters < 5000 then '3–5 km'
      else '5+ km' end,
    '{}'::text[]
  from public.profiles candidate
  join public.discovery_preferences candidate_pref on candidate_pref.user_id = candidate.id and candidate_pref.enabled
  join private.discovery_locations loc on loc.user_id = candidate.id
  join public.profiles viewer on viewer.id = v_user_id and viewer.account_status = 'active'
  cross join lateral (
    select 6371000 * 2 * asin(sqrt(least(1.0,
      power(sin(radians(loc.latitude - p_latitude) / 2), 2)
      + cos(radians(p_latitude)) * cos(radians(loc.latitude))
        * power(sin(radians(loc.longitude - p_longitude) / 2), 2)
    ))) as meters
  ) d
  where candidate.id <> v_user_id and candidate.account_status = 'active'
    and (candidate_pref.expires_at is null or candidate_pref.expires_at > now())
    and (loc.expires_at is null or loc.expires_at > now())
    and d.meters <= p_radius_m
    and not private.users_are_blocked(v_user_id, candidate.id)
    and (
      coalesce(cardinality(viewer.meet_preferences), 0) = 0
      or 'Everyone' = any(viewer.meet_preferences)
      or private.gender_category(candidate.gender) = any(viewer.meet_preferences)
    )
    and (
      coalesce(cardinality(candidate.meet_preferences), 0) = 0
      or 'Everyone' = any(candidate.meet_preferences)
      or private.gender_category(viewer.gender) = any(candidate.meet_preferences)
    )
  order by d.meters, candidate.id
  limit 100;
end;
$$;

create or replace function public.my_profile_qr_token()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid(); v_token uuid;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select p.qr_token into v_token from public.profiles p
    where p.id = v_user_id and p.account_status = 'active';
  if v_token is null then raise exception 'Active profile required'; end if;
  return v_token;
end;
$$;

create or replace function public.resolve_profile_qr(p_token uuid)
returns table(
  profile_id uuid,
  display_name text,
  age smallint,
  photo_path text,
  bio text,
  gender_label text,
  social_links jsonb,
  distance_range text,
  interests text[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid(); v_profile_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select p.id into v_profile_id from public.profiles p
    where p.qr_token = p_token and p.account_status = 'active' and p.id <> v_user_id;
  if v_profile_id is null or private.users_are_blocked(v_user_id, v_profile_id) then
    return;
  end if;
  insert into private.profile_view_grants(viewer_id, profile_id, expires_at)
    values (v_user_id, v_profile_id, now() + interval '10 minutes')
    on conflict (viewer_id, profile_id) do update set expires_at = excluded.expires_at;
  return query
  select p.id, p.display_name, p.age, p.photo_path, p.bio,
    case when p.show_gender then
      case when p.gender = 'Self-describe' then nullif(p.gender_description, '')
        when p.gender = 'Prefer not to say' then null else p.gender end
      else null end,
    coalesce((select jsonb_agg(jsonb_build_object('platform', link.platform, 'value', link.handle, 'visible', true)
      order by link.platform) from public.profile_links link where link.user_id = p.id and link.visible), '[]'::jsonb),
    'Found by QR', '{}'::text[]
  from public.profiles p where p.id = v_profile_id;
end;
$$;

create or replace function public.send_connection_request(p_recipient_id uuid, p_initial_message text default '')
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid(); v_inserted_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_recipient_id is null or p_recipient_id = v_user_id then raise exception 'Choose another profile'; end if;
  if char_length(coalesce(p_initial_message, '')) > 2000 then raise exception 'Message is too long'; end if;
  if private.users_are_blocked(v_user_id, p_recipient_id) then raise exception 'This connection is unavailable'; end if;
  if not exists (select 1 from public.profiles p where p.id = v_user_id and p.account_status = 'active')
    or not exists (select 1 from public.profiles p where p.id = p_recipient_id and p.account_status = 'active') then
    raise exception 'This profile is unavailable';
  end if;
  insert into public.connection_requests(sender_id, recipient_id, initial_message)
    values (v_user_id, p_recipient_id, coalesce(p_initial_message, ''))
    on conflict do nothing returning id into v_inserted_id;
  return v_inserted_id is not null;
end;
$$;

create or replace function public.respond_to_connection_request(p_request_id uuid, p_accept boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid(); v_sender_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select r.sender_id into v_sender_id from public.connection_requests r
    where r.id = p_request_id and r.recipient_id = v_user_id and r.status = 'pending';
  if v_sender_id is null then return false; end if;
  if private.users_are_blocked(v_user_id, v_sender_id) then raise exception 'This request is unavailable'; end if;
  update public.connection_requests r
    set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now()
    where r.id = p_request_id and r.recipient_id = v_user_id and r.status = 'pending';
  return found;
end;
$$;

create or replace function public.my_inbox()
returns table(
  id uuid,
  profile_id uuid,
  display_name text,
  photo_path text,
  status text,
  first_message text,
  last_message text,
  updated_at timestamptz,
  unread_count integer,
  profile_preview jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  insert into private.profile_view_grants(viewer_id, profile_id, expires_at)
  select v_user_id, p.id, now() + interval '10 minutes'
  from public.connection_requests r
  join public.profiles p on p.id = case when r.sender_id = v_user_id then r.recipient_id else r.sender_id end
  where (r.sender_id = v_user_id or r.recipient_id = v_user_id)
    and (r.status = 'accepted' or (r.status = 'pending' and r.recipient_id = v_user_id))
    and p.account_status = 'active'
    and not private.users_are_blocked(v_user_id, p.id)
  on conflict (viewer_id, profile_id) do update set expires_at = excluded.expires_at;

  return query
  select r.id,
    p.id,
    p.display_name,
    p.photo_path,
    case when r.status = 'accepted' then 'chat' else 'request' end,
    r.initial_message,
    coalesce(latest.body, r.initial_message, ''),
    coalesce(latest.created_at, r.responded_at, r.created_at),
    case when r.status = 'pending' then 1 else (
      select count(*)::integer from public.messages unread
      where unread.request_id = r.id and unread.sender_id <> v_user_id
        and unread.created_at > coalesce(
          case when r.sender_id = v_user_id then r.sender_read_at else r.recipient_read_at end,
          r.created_at
        )
    ) end,
    jsonb_build_object('bio', p.bio, 'genderLabel', case when p.show_gender then
      case when p.gender = 'Self-describe' then nullif(p.gender_description, '')
        when p.gender = 'Prefer not to say' then null else p.gender end else null end)
  from public.connection_requests r
  join public.profiles p on p.id = case when r.sender_id = v_user_id then r.recipient_id else r.sender_id end
  left join lateral (
    select m.body, m.created_at from public.messages m
      where m.request_id = r.id order by m.created_at desc limit 1
  ) latest on true
  where (r.status = 'accepted' or (r.status = 'pending' and r.recipient_id = v_user_id))
    and (r.sender_id = v_user_id or r.recipient_id = v_user_id)
    and p.account_status = 'active'
    and not private.users_are_blocked(v_user_id, p.id)
  order by coalesce(latest.created_at, r.responded_at, r.created_at) desc;
end;
$$;

create or replace function public.mark_conversation_read(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  update public.connection_requests r
    set sender_read_at = case when r.sender_id = v_user_id then now() else r.sender_read_at end,
        recipient_read_at = case when r.recipient_id = v_user_id then now() else r.recipient_read_at end
    where r.id = p_request_id and r.status = 'accepted'
      and (r.sender_id = v_user_id or r.recipient_id = v_user_id)
      and not private.users_are_blocked(r.sender_id, r.recipient_id);
  return found;
end;
$$;

create or replace function public.set_profile_blocked(p_profile_id uuid, p_blocked boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_profile_id is null or p_profile_id = v_user_id then raise exception 'Choose another profile'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_profile_id) then return false; end if;
  if p_blocked then
    insert into public.user_blocks(blocked_by, blocked_user) values (v_user_id, p_profile_id)
      on conflict do nothing;
  else
    delete from public.user_blocks b where b.blocked_by = v_user_id and b.blocked_user = p_profile_id;
  end if;
  return true;
end;
$$;

create or replace function public.my_blocked_profiles()
returns table(profile_id uuid, display_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  return query select p.id, coalesce(nullif(p.display_name, ''), 'CatchYa account')
    from public.user_blocks b join public.profiles p on p.id = b.blocked_user
    where b.blocked_by = v_user_id order by b.created_at desc;
end;
$$;

create or replace function public.report_profile(p_profile_id uuid, p_reason text default 'profile')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid(); v_report_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_profile_id is null or p_profile_id = v_user_id then raise exception 'Choose another profile'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_profile_id) then raise exception 'Profile unavailable'; end if;
  insert into public.profile_reports(reporter_id, reported_user, reason)
    values (v_user_id, p_profile_id, left(coalesce(nullif(trim(p_reason), ''), 'profile'), 80))
    returning id into v_report_id;
  return v_report_id;
end;
$$;

create or replace function public.deactivate_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  update public.profiles set account_status = 'deactivated', updated_at = now() where id = v_user_id;
  update public.discovery_preferences set enabled = false, expires_at = null, updated_at = now() where user_id = v_user_id;
  delete from private.discovery_locations where user_id = v_user_id;
end;
$$;

create or replace function public.reactivate_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.profiles set account_status = 'active', updated_at = now() where id = auth.uid();
end;
$$;

create or replace function public.my_account_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.account_status = 'active');
$$;

-- Register all API functions explicitly; none is executable by anonymous clients.
revoke all on function public.set_my_discovery(boolean, text, double precision, double precision) from public, anon;
revoke all on function public.my_discovery_preferences() from public, anon;
revoke all on function public.nearby_profiles(double precision, double precision, integer) from public, anon;
revoke all on function public.my_profile_qr_token() from public, anon;
revoke all on function public.resolve_profile_qr(uuid) from public, anon;
revoke all on function public.send_connection_request(uuid, text) from public, anon;
revoke all on function public.respond_to_connection_request(uuid, boolean) from public, anon;
revoke all on function public.my_inbox() from public, anon;
revoke all on function public.mark_conversation_read(uuid) from public, anon;
revoke all on function public.set_profile_blocked(uuid, boolean) from public, anon;
revoke all on function public.my_blocked_profiles() from public, anon;
revoke all on function public.report_profile(uuid, text) from public, anon;
revoke all on function public.deactivate_my_account() from public, anon;
revoke all on function public.reactivate_my_account() from public, anon;
revoke all on function public.my_account_is_active() from public, anon;
grant execute on function public.set_my_discovery(boolean, text, double precision, double precision) to authenticated;
grant execute on function public.my_discovery_preferences() to authenticated;
grant execute on function public.nearby_profiles(double precision, double precision, integer) to authenticated;
grant execute on function public.my_profile_qr_token() to authenticated;
grant execute on function public.resolve_profile_qr(uuid) to authenticated;
grant execute on function public.send_connection_request(uuid, text) to authenticated;
grant execute on function public.respond_to_connection_request(uuid, boolean) to authenticated;
grant execute on function public.my_inbox() to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.set_profile_blocked(uuid, boolean) to authenticated;
grant execute on function public.my_blocked_profiles() to authenticated;
grant execute on function public.report_profile(uuid, text) to authenticated;
grant execute on function public.deactivate_my_account() to authenticated;
grant execute on function public.reactivate_my_account() to authenticated;
grant execute on function public.my_account_is_active() to authenticated;

-- Private, owner-path-scoped profile photos. The app requests 5-minute signed URLs
-- only after an RPC has granted that viewer a short-lived profile view.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

create policy catchya_photo_read on storage.objects
  for select to authenticated using (
    bucket_id = 'profile-photos'
    and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and private.viewer_can_see_photo(split_part(name, '/', 1)::uuid)
  );
create policy catchya_photo_insert_own on storage.objects
  for insert to authenticated with check (
    bucket_id = 'profile-photos' and split_part(name, '/', 1) = (select auth.uid())::text
  );
create policy catchya_photo_update_own on storage.objects
  for update to authenticated using (
    bucket_id = 'profile-photos' and split_part(name, '/', 1) = (select auth.uid())::text
  ) with check (
    bucket_id = 'profile-photos' and split_part(name, '/', 1) = (select auth.uid())::text
  );
create policy catchya_photo_delete_own on storage.objects
  for delete to authenticated using (
    bucket_id = 'profile-photos' and split_part(name, '/', 1) = (select auth.uid())::text
  );

-- Supabase Realtime is used by the accepted-chat screen. RLS still filters every row.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
exception when undefined_object then
  -- Local PostgreSQL without Supabase Realtime; migrations and pgTAP still run.
  null;
end;
$$;

-- If pg_cron is available, remove expired exact locations and turn their switches off.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
    if to_regnamespace('cron') is not null then
      if exists (select 1 from cron.job where jobname = 'catchya-expire-discovery') then
        perform cron.unschedule(jobid) from cron.job where jobname = 'catchya-expire-discovery';
      end if;
      perform cron.schedule('catchya-expire-discovery', '* * * * *',
        $job$delete from private.discovery_locations where expires_at is not null and expires_at <= now();
             update public.discovery_preferences set enabled = false, expires_at = null, updated_at = now()
               where enabled and expires_at is not null and expires_at <= now();$job$);
    end if;
  end if;
exception when insufficient_privilege or undefined_table then
  null;
end;
$$;
