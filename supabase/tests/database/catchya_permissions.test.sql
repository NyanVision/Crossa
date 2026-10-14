begin;
select plan(47);

-- Disposable auth rows create their matching CatchYa profiles via the migration trigger.
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('a0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'catchya-test-a@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{"name":"Test A"}'),
  ('b0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'catchya-test-b@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{"name":"Test B"}'),
  ('c0000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'catchya-test-c@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{"name":"Test C"}')
on conflict (id) do nothing;

-- Moderators are provisioned only by trusted database administrators.
insert into private.moderator_roles (user_id, role, granted_by)
values ('a0000000-0000-4000-8000-000000000001', 'admin', 'a0000000-0000-4000-8000-000000000001')
on conflict (user_id) do update set role = excluded.role, revoked_at = null;

insert into public.connection_requests (id, sender_id, recipient_id, initial_message, status, created_at)
values
  ('d0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'Pending hello', 'pending', now()),
  ('e0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000003', 'Accepted hello', 'accepted', now());
insert into public.profile_reports (id, reporter_id, reported_user, reason)
values ('f0000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000002', 'Test report');

-- Client-role tests run with realistic Supabase JWT claim settings.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);

select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
select is(public.my_account_is_active(), true, 'authenticated signup creates an active profile');
select throws_ok(
  $$ update public.profiles set account_status = 'deactivated' where id = 'a0000000-0000-4000-8000-000000000001' $$,
  '42501', null,
  'clients cannot bypass account lifecycle RPCs through direct profile updates'
);
select throws_ok(
  $$ select private.account_is_active('b0000000-0000-4000-8000-000000000002') $$,
  '42501', null,
  'authenticated clients cannot probe another account status through the private helper'
);
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
select is(public.my_moderator_role(), null, 'ordinary accounts do not learn moderator roles');
select throws_ok(
  $$ select * from public.moderation_report_queue(50) $$,
  'P0001', 'Moderator access required',
  'non-moderators cannot read the report queue'
);
select throws_ok(
  $$ select role from private.moderator_roles limit 1 $$,
  '42501', null,
  'clients cannot inspect the private moderator-role table'
);
select throws_ok(
  $$ insert into public.push_devices (user_id, installation_id, expo_push_token, platform) values ('b0000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'ExponentPushToken[test]', 'ios') $$,
  '42501', null,
  'clients cannot insert push tokens directly'
);
select throws_ok(
  $$ select * from public.push_devices limit 1 $$,
  '42501', null,
  'clients cannot read device tokens'
);

select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000003', true);
select is(
  (select count(*)::integer from public.send_chat_message(
    'e0000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000002', 'Accepted chat works')),
  1,
  'a participant can send a message in an accepted conversation through the trusted RPC'
);
select is(
  (select count(*)::integer from public.messages where request_id = 'e0000000-0000-4000-8000-000000000005'),
  1,
  'a participant can read messages in an accepted conversation'
);
select is(public.set_conversation_hidden('e0000000-0000-4000-8000-000000000005', true), true, 'a participant can hide their own conversation');
select is((select count(*)::integer from public.my_inbox(null, null, 50)), 0, 'hiding removes the conversation from only this participant’s inbox');
select is(public.set_conversation_hidden('e0000000-0000-4000-8000-000000000005', false), true, 'a participant can restore a hidden conversation');
select is((select count(*)::integer from public.my_inbox(null, null, 50)), 1, 'unhiding restores the accepted conversation');
select is((select count(*)::integer from public.messages where request_id = 'e0000000-0000-4000-8000-000000000005'), 1, 'hiding does not delete conversation history');
select is(public.set_profile_blocked('b0000000-0000-4000-8000-000000000002', true), true, 'blocking is stored by the authenticated owner');
select throws_ok(
  $$ select * from public.list_conversation_messages('e0000000-0000-4000-8000-000000000005') $$,
  'P0001', 'Accepted conversation access required',
  'blocking prevents access to accepted chat history'
);
select is((select count(*)::integer from public.messages where request_id = 'e0000000-0000-4000-8000-000000000005'), 0, 'RLS also hides blocked conversation messages');
select is(public.set_profile_blocked('b0000000-0000-4000-8000-000000000002', false), true, 'the blocker can remove their own block');
select throws_ok(
  $$ do $rate$ declare i integer; begin for i in 1..11 loop perform public.send_connection_request('b0000000-0000-4000-8000-000000000002', 'rate test'); end loop; end $rate$ $$,
  'P0001', 'Too many requests. Try again later',
  'the connection-request rate limit is enforced by the server'
);
select throws_ok(
  $$ do $rate$ declare i integer; begin for i in 1..41 loop perform public.send_chat_message('e0000000-0000-4000-8000-000000000005', gen_random_uuid(), 'rate test'); end loop; end $rate$ $$,
  'P0001', 'You are sending messages too quickly',
  'the chat-message rate limit is enforced by the server'
);
select throws_ok(
  $$ do $rate$ declare i integer; begin for i in 1..6 loop perform public.report_profile('b0000000-0000-4000-8000-000000000002', 'rate test'); end loop; end $rate$ $$,
  'P0001', 'Report limit reached. Try again tomorrow',
  'the profile-report rate limit is enforced by the server'
);

select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
select is(public.my_moderator_role(), 'admin', 'the moderator role accessor returns only the caller’s role');
select is((select count(*)::integer from public.moderation_report_queue(50)), 1, 'an authorized moderator can review open reports');
select is(public.moderate_profile_report('f0000000-0000-4000-8000-000000000006', 'warn', 'Test review'), true, 'an authorized moderator can record a report decision');
select is((select count(*)::integer from public.moderation_report_queue(50)), 0, 'resolved reports leave the open queue');
select is(public.moderate_account_status('b0000000-0000-4000-8000-000000000002', 'suspend', 'Test suspension'), true, 'an authorized moderator can suspend an account');

select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000002', true);
select is(public.my_account_is_active(), false, 'suspended account state is enforced by the backend');
select throws_ok(
  $$ select public.reactivate_my_account() $$,
  'P0001', 'This account is suspended. Contact CatchYa support.',
  'the standard reactivation RPC cannot restore a suspended account'
);
select is((select count(*)::integer from public.messages where request_id = 'e0000000-0000-4000-8000-000000000005'), 0, 'suspension revokes message reads for both participants');

select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
select is((select duration from public.set_my_discovery(true, '15 minutes', 37.7749, -122.4194)), '15 minutes', 'the 15-minute discovery option is accepted');
select ok((select expires_at between now() + interval '14 minutes' and now() + interval '16 minutes' from public.my_discovery_preferences()), 'the 15-minute option expires on the server');
select is((select duration from public.set_my_discovery(true, '1 hour', 37.7749, -122.4194)), '1 hour', 'the 1-hour discovery option is accepted');
select ok((select expires_at between now() + interval '59 minutes' and now() + interval '61 minutes' from public.my_discovery_preferences()), 'the 1-hour option expires on the server');

-- Expiry reads fail closed immediately, and the installed cron job performs physical cleanup.
reset role;
update public.discovery_preferences set expires_at = now() - interval '1 second' where user_id = 'a0000000-0000-4000-8000-000000000001';
update private.discovery_locations set expires_at = now() - interval '1 second' where user_id = 'a0000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
select is((select enabled from public.my_discovery_preferences()), false, 'expired discovery immediately returns disabled');
reset role;
select is((select count(*)::integer from private.discovery_locations where user_id = 'a0000000-0000-4000-8000-000000000001'), 0, 'expired exact location is physically removed');
select ok(exists(select 1 from cron.job where jobname = 'catchya-expire-private-data'), 'server-side expiry cleanup is scheduled every minute');
select ok(exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'connection_requests'), 'request updates are published for the RLS-filtered inbox subscription');

select finish();
rollback;
