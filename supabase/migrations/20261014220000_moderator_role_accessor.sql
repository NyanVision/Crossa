-- Let the authenticated app hide/show the moderation entry point without exposing
-- the private role table. Queue access and every action remain moderator-checked.
create or replace function public.my_moderator_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.role
  from private.moderator_roles r
  where r.user_id = (select auth.uid())
    and r.revoked_at is null
    and private.account_is_active((select auth.uid()))
  limit 1;
$$;

revoke all on function public.my_moderator_role() from public, anon;
grant execute on function public.my_moderator_role() to authenticated;
