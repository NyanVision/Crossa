begin;
select plan(13);

-- Disposable auth rows create their matching CatchYa profiles via the migration trigger.
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('a0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'catchya-test-a@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{"name":"Test A"}'),
  ('b0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'catchya-test-b@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{"name":"Test B"}'),
  ('c0000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'catchya-test-c@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{"name":"Test C"}')
on conflict (id) do nothing;

insert into public.connection_requests (id, sender_id, recipient_id, initial_message, status, created_at)
values
  ('d0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'Pending hello', 'pending', now()),
  ('e0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000003', 'Accepted hello', 'accepted', now());

-- Client-role tests run with realistic Supabase JWT claim settings.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);

select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
select is(public.my_account_is_active(), true, 'authenticated signup creates an active profile');
select is((select count(*)::integer from public.profiles where id = 'b0000000-0000-4000-8000-000000000002'), 0, 'RLS hides another account profile from direct reads');
select throws_ok(
  $$ select * from public.nearby_profiles(37.7749, -122.4194, 5000) $$,
  'P0001', 'Turn on nearby discovery before scanning',
  'nearby discovery rejects a user until discovery has been explicitly enabled'
);
select is(
  (select duration from public.set_my_discovery(true, '30 minutes', 37.7749, -122.4194)),
  '30 minutes',
  'the discovery RPC accepts the 30-minute option'
);
select ok(
  (select expires_at between now() + interval '29 minutes' and now() + interval '31 minutes'
    from public.my_discovery_preferences()),
  'the 30-minute option receives a server-side 30-minute expiry'
);
select throws_ok(
  $$ select * from public.set_my_discovery(true, 'Until I turn it off', 37.7749, -122.4194) $$,
  'P0001', 'Unsupported discovery duration',
  'unsupported indefinite durations are rejected by the backend'
);
select throws_ok(
  $$ select latitude from private.discovery_locations limit 1 $$,
  '42501', null,
  'authenticated clients cannot query exact private discovery coordinates'
);
select is(
  public.respond_to_connection_request('d0000000-0000-4000-8000-000000000004', true),
  false,
  'only the pending request recipient may accept it'
);
select throws_ok(
  $$ insert into public.messages (request_id, sender_id, body) values ('d0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'Not allowed yet') $$,
  '42501', null,
  'message inserts are denied while the connection request is pending'
);

select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000002', true);
select is(
  public.respond_to_connection_request('d0000000-0000-4000-8000-000000000004', true),
  true,
  'the intended recipient can accept a pending request'
);

select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000003', true);
with inserted as (
  insert into public.messages (request_id, sender_id, body)
  values ('e0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000003', 'Accepted chat works')
  returning request_id
)
select is((select count(*)::integer from inserted), 1, 'a participant can message in an accepted conversation');
select is(
  (select count(*)::integer from public.messages where request_id = 'e0000000-0000-4000-8000-000000000005'),
  1,
  'a participant can read messages in an accepted conversation'
);

select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
select is(
  (select count(*)::integer from public.messages where request_id = 'e0000000-0000-4000-8000-000000000005'),
  0,
  'a nonparticipant cannot read an accepted conversation'
);

reset role;
select finish();
rollback;
