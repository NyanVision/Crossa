alter policy avatars_insert_own on storage.objects with check (
 bucket_id = 'avatars'
 and (storage.foldername(name))[1] = (select auth.uid())::text
 and array_length(storage.foldername(name), 1) = 1
 and exists (select 1 from public.profiles where id = (select auth.uid()))
);