-- Correct lifecycle ordering for the new active-account guards.
-- This is intentionally separate and forward-only so an already applied hardening
-- migration can be upgraded without resetting or deleting any account data.

drop trigger if exists profiles_active_write_guard on public.profiles;

create or replace function public.deactivate_my_account()
returns void language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not private.account_is_active(v_uid) then raise exception 'Only an active account can be deactivated'; end if;
  update public.discovery_preferences set enabled = false, expires_at = null, updated_at = now() where user_id = v_uid;
  delete from private.discovery_locations where user_id = v_uid;
  update public.user_preferences set notifications_enabled = false, updated_at = now() where user_id = v_uid;
  update public.push_devices set enabled = false, updated_at = now() where user_id = v_uid;
  update public.profiles set account_status = 'deactivated', updated_at = now() where id = v_uid;
end;
$$;

create or replace function public.moderate_profile_report(p_report_id uuid, p_action text, p_note text default '')
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_target uuid; v_status text;
begin
  if v_actor is null or not private.account_is_active(v_actor) or not private.is_active_moderator(v_actor) then
    raise exception 'Moderator access required';
  end if;
  if p_action not in ('dismiss', 'warn', 'suspend') then raise exception 'Unsupported moderation action'; end if;
  select r.reported_user, r.status into v_target, v_status
    from public.profile_reports r where r.id = p_report_id for update;
  if v_target is null or v_status <> 'open' then return false; end if;
  update public.profile_reports set status = 'resolved', reviewed_by = v_actor, reviewed_at = now() where id = p_report_id;
  insert into private.moderation_actions(report_id, actor_id, target_user_id, action, note)
    values (p_report_id, v_actor, v_target, p_action, left(coalesce(p_note, ''), 1000));
  if p_action = 'suspend' then
    update public.discovery_preferences set enabled = false, expires_at = null, updated_at = now() where user_id = v_target;
    delete from private.discovery_locations where user_id = v_target;
    update public.user_preferences set notifications_enabled = false, updated_at = now() where user_id = v_target;
    update public.push_devices set enabled = false, updated_at = now() where user_id = v_target;
    update public.profiles set account_status = 'suspended', suspended_at = now(),
      suspension_reason = left(coalesce(p_note, 'Policy review'), 500), updated_at = now() where id = v_target;
  end if;
  return true;
end;
$$;

create or replace function public.moderate_account_status(p_target_user uuid, p_action text, p_note text default '')
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_changed boolean := false;
begin
  if v_actor is null or not private.account_is_active(v_actor) or not private.is_active_moderator(v_actor) then
    raise exception 'Moderator access required';
  end if;
  if p_action not in ('suspend', 'unsuspend') or p_target_user is null or p_target_user = v_actor then
    raise exception 'Unsupported account action';
  end if;
  if p_action = 'suspend' then
    update public.discovery_preferences set enabled = false, expires_at = null, updated_at = now() where user_id = p_target_user;
    delete from private.discovery_locations where user_id = p_target_user;
    update public.user_preferences set notifications_enabled = false, updated_at = now() where user_id = p_target_user;
    update public.push_devices set enabled = false, updated_at = now() where user_id = p_target_user;
    update public.profiles set account_status = 'suspended', suspended_at = now(),
      suspension_reason = left(coalesce(p_note, 'Policy review'), 500), updated_at = now()
      where id = p_target_user and account_status = 'active';
    v_changed := found;
  else
    update public.profiles set account_status = 'active', suspended_at = null, suspension_reason = null, updated_at = now()
      where id = p_target_user and account_status = 'suspended';
    v_changed := found;
  end if;
  if not v_changed then return false; end if;
  insert into private.moderation_actions(actor_id, target_user_id, action, note)
    values (v_actor, p_target_user, p_action, left(coalesce(p_note, ''), 1000));
  return true;
end;
$$;

revoke all on function public.deactivate_my_account() from public, anon;
grant execute on function public.deactivate_my_account() to authenticated;
revoke all on function public.moderate_profile_report(uuid, text, text) from public, anon;
grant execute on function public.moderate_profile_report(uuid, text, text) to authenticated;
revoke all on function public.moderate_account_status(uuid, text, text) from public, anon;
grant execute on function public.moderate_account_status(uuid, text, text) to authenticated;
