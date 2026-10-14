-- Forward migration for databases that already applied the initial CatchYa schema.
-- Discovery is opt-in and now supports exactly 15 minutes, 30 minutes, or 1 hour.
update public.discovery_preferences
  set duration = '1 hour',
      expires_at = case when enabled then now() + interval '1 hour' else null end,
      updated_at = now()
  where duration = 'Until I turn it off';

update private.discovery_locations l
  set expires_at = d.expires_at
  from public.discovery_preferences d
  where d.user_id = l.user_id and d.enabled and d.duration = '1 hour';

alter table public.discovery_preferences
  drop constraint if exists discovery_preferences_duration_check;
alter table public.discovery_preferences
  add constraint discovery_duration_supported
  check (duration in ('15 minutes', '30 minutes', '1 hour'));

alter table public.discovery_preferences
  drop constraint if exists discovery_expiry_matches_duration;

alter table public.discovery_preferences
  add constraint discovery_expiry_matches_duration check (
    (not enabled and expires_at is null)
    or (enabled and duration in ('15 minutes', '30 minutes', '1 hour') and expires_at is not null)
  );

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
          duration = case when p_duration in ('15 minutes', '30 minutes', '1 hour') then p_duration else d.duration end,
          expires_at = null, updated_at = now()
      where d.user_id = v_user_id;
    delete from private.discovery_locations l where l.user_id = v_user_id;
    return query select false, coalesce((select d.duration from public.discovery_preferences d where d.user_id = v_user_id), '15 minutes'), null::timestamptz;
    return;
  end if;
  if p_duration is null or p_duration not in ('15 minutes', '30 minutes', '1 hour') then
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
    when '30 minutes' then now() + interval '30 minutes'
    when '1 hour' then now() + interval '1 hour'
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
