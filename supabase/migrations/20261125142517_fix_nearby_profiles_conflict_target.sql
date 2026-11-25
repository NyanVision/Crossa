-- Preserve the already deployed discovery repair in the migration history.
CREATE OR REPLACE FUNCTION public.nearby_profiles(p_latitude double precision, p_longitude double precision, p_radius_m integer DEFAULT 10000)
 RETURNS TABLE(profile_id uuid, display_name text, age smallint, photo_path text, bio text, gender_label text, social_links jsonb, distance_range text, interests text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  on conflict on constraint profile_view_grants_pkey do update set expires_at = excluded.expires_at;

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
$function$
