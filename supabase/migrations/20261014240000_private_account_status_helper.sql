-- Prevent callers from directly checking the active/deactivated/suspended state
-- of arbitrary account UUIDs. RLS uses the caller-only public helper; trusted
-- SECURITY DEFINER RPCs continue to use the private helper as the function owner.
revoke execute on function private.account_is_active(uuid) from public, anon, authenticated;
grant execute on function private.account_is_active(uuid) to service_role;

-- Direct RLS predicates need only the caller's state. Peer state stays inside this
-- constrained accepted-conversation predicate rather than a general UUID oracle.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated
  using ((select auth.uid()) = id and (select public.my_account_is_active()));
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using ((select auth.uid()) = id and (select public.my_account_is_active()))
  with check ((select auth.uid()) = id and (select public.my_account_is_active()));

drop policy if exists profile_links_select_own on public.profile_links;
create policy profile_links_select_own on public.profile_links for select to authenticated
  using ((select auth.uid()) = user_id and (select public.my_account_is_active()));
drop policy if exists profile_links_insert_own on public.profile_links;
create policy profile_links_insert_own on public.profile_links for insert to authenticated
  with check ((select auth.uid()) = user_id and (select public.my_account_is_active()));
drop policy if exists profile_links_update_own on public.profile_links;
create policy profile_links_update_own on public.profile_links for update to authenticated
  using ((select auth.uid()) = user_id and (select public.my_account_is_active()))
  with check ((select auth.uid()) = user_id and (select public.my_account_is_active()));
drop policy if exists profile_links_delete_own on public.profile_links;
create policy profile_links_delete_own on public.profile_links for delete to authenticated
  using ((select auth.uid()) = user_id and (select public.my_account_is_active()));

drop policy if exists user_preferences_select_own on public.user_preferences;
create policy user_preferences_select_own on public.user_preferences for select to authenticated
  using ((select auth.uid()) = user_id and (select public.my_account_is_active()));
drop policy if exists user_preferences_update_own on public.user_preferences;
create policy user_preferences_update_own on public.user_preferences for update to authenticated
  using ((select auth.uid()) = user_id and (select public.my_account_is_active()))
  with check ((select auth.uid()) = user_id and (select public.my_account_is_active()));
drop policy if exists discovery_preferences_select_own on public.discovery_preferences;
create policy discovery_preferences_select_own on public.discovery_preferences for select to authenticated
  using ((select auth.uid()) = user_id and (select public.my_account_is_active()));

drop policy if exists requests_select_participant on public.connection_requests;
create policy requests_select_participant on public.connection_requests for select to authenticated
  using ((sender_id = (select auth.uid()) or recipient_id = (select auth.uid()))
    and (select public.my_account_is_active())
    and not private.users_are_blocked(sender_id, recipient_id));

create or replace function private.accepted_chat_is_available(p_request_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null
    and private.account_is_active(auth.uid())
    and exists (
      select 1 from public.connection_requests r
      where r.id = p_request_id and r.status = 'accepted'
        and (r.sender_id = auth.uid() or r.recipient_id = auth.uid())
        and private.account_is_active(r.sender_id)
        and private.account_is_active(r.recipient_id)
        and not private.users_are_blocked(r.sender_id, r.recipient_id)
    );
$$;
revoke all on function private.accepted_chat_is_available(uuid) from public, anon;
grant execute on function private.accepted_chat_is_available(uuid) to authenticated;

drop policy if exists messages_select_accepted_participant on public.messages;
create policy messages_select_accepted_participant on public.messages for select to authenticated
  using ((select public.my_account_is_active()) and private.accepted_chat_is_available(request_id));

drop policy if exists blocks_select_owner on public.user_blocks;
create policy blocks_select_owner on public.user_blocks for select to authenticated
  using (blocked_by = (select auth.uid()) and (select public.my_account_is_active()));
drop policy if exists blocks_insert_owner on public.user_blocks;
create policy blocks_insert_owner on public.user_blocks for insert to authenticated
  with check (blocked_by = (select auth.uid()) and (select public.my_account_is_active()));
drop policy if exists blocks_delete_owner on public.user_blocks;
create policy blocks_delete_owner on public.user_blocks for delete to authenticated
  using (blocked_by = (select auth.uid()) and (select public.my_account_is_active()));
drop policy if exists reports_select_reporter on public.profile_reports;
create policy reports_select_reporter on public.profile_reports for select to authenticated
  using (reporter_id = (select auth.uid()) and (select public.my_account_is_active()));
