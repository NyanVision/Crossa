create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 40),
  bio text not null default '' check (char_length(bio) <= 120),
  avatar_path text check (avatar_path is null or avatar_path like id::text || '/%'),
  social_links jsonb not null default '[]'::jsonb check (jsonb_typeof(social_links) = 'array' and octet_length(social_links::text) <= 16000),
  about_you jsonb not null default '{}'::jsonb check (jsonb_typeof(about_you) = 'object' and octet_length(about_you::text) <= 2000),
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint completed_profile_has_name check (not onboarding_completed or char_length(btrim(display_name)) > 0)
);
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
create policy profiles_select_own on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy profiles_insert_own on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 5242880, array['image/jpeg', 'image/png']);
create policy avatars_select_own on storage.objects for select to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_insert_own on storage.objects for insert to authenticated
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
and exists (select 1 from public.profiles where id = (select auth.uid())));
create policy avatars_delete_own on storage.objects for delete to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
