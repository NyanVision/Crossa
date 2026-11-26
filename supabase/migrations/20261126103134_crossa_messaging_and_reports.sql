-- Requests, chat recovery, receipts, typing, and a permission-gated report queue.
-- Existing accounts and messages are preserved. Client roles cannot assign moderators.
alter table public.connection_requests drop constraint connection_requests_status_check;
alter table public.connection_requests add constraint connection_requests_status_check
  check (status in ('pending', 'accepted', 'declined', 'cancelled'));
create index connection_requests_sender_recent_idx on public.connection_requests(sender_id, created_at desc);
create index messages_sender_recent_idx on public.messages(sender_id, created_at desc);
create index messages_cursor_idx on public.messages(request_id, created_at desc, id desc);

create function private.can_open_chat(p_request_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.connection_requests r
    join public.profiles a on a.id=r.sender_id and a.account_status='active'
    join public.profiles b on b.id=r.recipient_id and b.account_status='active'
    where r.id=p_request_id and r.status='accepted'
      and auth.uid() in (r.sender_id,r.recipient_id)
      and not private.users_are_blocked(r.sender_id,r.recipient_id)
  );
$$;
revoke all on function private.can_open_chat(uuid) from public, anon;
grant execute on function private.can_open_chat(uuid) to authenticated;

drop policy messages_select_accepted_participant on public.messages;
drop policy messages_insert_accepted_sender on public.messages;
create policy messages_select_accepted_participant on public.messages for select to authenticated
  using (private.can_open_chat(request_id));
create policy messages_insert_accepted_sender on public.messages for insert to authenticated
  with check (sender_id=(select auth.uid()) and private.can_open_chat(request_id));

create or replace function public.send_connection_request(p_recipient_id uuid, p_initial_message text default '')
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_id uuid;
begin
  if v_user is null then raise exception 'Sign in before sending a request.'; end if;
  if p_recipient_id is null or p_recipient_id=v_user then raise exception 'Choose another profile.'; end if;
  if char_length(coalesce(p_initial_message,''))>2000 then raise exception 'Message is too long.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('crossa-requests:'||v_user::text,0));
  perform pg_advisory_xact_lock(hashtextextended('crossa-pair:'||least(v_user,p_recipient_id)::text||greatest(v_user,p_recipient_id)::text,0));
  if private.users_are_blocked(v_user,p_recipient_id)
    or (select count(*) from public.profiles p where p.id in (v_user,p_recipient_id) and p.account_status='active')<>2 then
    raise exception 'This profile is unavailable.';
  end if;
  if exists(select 1 from public.connection_requests r where
    least(r.sender_id,r.recipient_id)=least(v_user,p_recipient_id)
    and greatest(r.sender_id,r.recipient_id)=greatest(v_user,p_recipient_id)
    and r.status in ('pending','accepted')) then return false; end if;
  if exists(select 1 from public.connection_requests r where r.sender_id=v_user and r.recipient_id=p_recipient_id
    and ((r.status='declined' and r.responded_at>now()-interval '24 hours')
      or (r.status='cancelled' and r.responded_at>now()-interval '5 minutes'))) then
    raise exception 'Please wait before sending this person another request. Declined requests have a 24-hour cooldown; cancelled requests have a 5-minute cooldown.';
  end if;
  if (select count(*) from public.connection_requests r where r.sender_id=v_user and r.created_at>now()-interval '1 minute')>=10
    or (select count(*) from public.connection_requests r where r.sender_id=v_user and r.created_at>now()-interval '24 hours')>=50 then
    raise exception 'You have sent too many requests. Please try again later.';
  end if;
  insert into public.connection_requests(sender_id,recipient_id,initial_message)
    values(v_user,p_recipient_id,coalesce(p_initial_message,'')) on conflict do nothing returning id into v_id;
  return v_id is not null;
end;
$$;

create function public.cancel_connection_request(p_request_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  update public.connection_requests r set status='cancelled',responded_at=now()
    where r.id=p_request_id and r.sender_id=auth.uid() and r.status='pending';
  return found;
end;
$$;

create function public.my_sent_requests(p_limit integer default 100)
returns table(id uuid,profile_id uuid,display_name text,photo_path text,status text,created_at timestamptz,cooldown_until timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  insert into private.profile_view_grants(viewer_id,profile_id,expires_at)
    select distinct auth.uid(),r.recipient_id,now()+interval '10 minutes'
    from public.connection_requests r join public.profiles p on p.id=r.recipient_id
    where r.sender_id=auth.uid() and p.account_status='active'
      and not private.users_are_blocked(r.sender_id,r.recipient_id)
    on conflict on constraint profile_view_grants_pkey do update set expires_at=excluded.expires_at;
  return query select r.id,p.id,p.display_name,p.photo_path,r.status,r.created_at,
    case when r.status='declined' then r.responded_at+interval '24 hours'
      when r.status='cancelled' then r.responded_at+interval '5 minutes' else null end
    from public.connection_requests r join public.profiles p on p.id=r.recipient_id
    where r.sender_id=auth.uid() and p.account_status='active'
      and not private.users_are_blocked(r.sender_id,r.recipient_id)
    order by r.created_at desc,r.id desc limit greatest(1,least(coalesce(p_limit,100),200));
end;
$$;

create function private.limit_chat_messages()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if; -- trusted service imports only
  if new.sender_id<>auth.uid() or not private.can_open_chat(new.request_id) then raise exception 'Conversation unavailable.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('crossa-messages:'||auth.uid()::text,0));
  if exists(select 1 from public.messages m where m.id=new.id and m.sender_id=auth.uid()
    and m.request_id=new.request_id and m.body=new.body) then return new; end if;
  if (select count(*) from public.messages m where m.sender_id=auth.uid() and m.created_at>now()-interval '1 minute')>=30
    or (select count(*) from public.messages m where m.sender_id=auth.uid() and m.created_at>now()-interval '1 hour')>=500 then
    raise exception 'You are sending messages too quickly. Please wait a moment.';
  end if;
  new.created_at:=now(); -- clients cannot backdate messages to bypass the limit
  return new;
end;
$$;
revoke all on function private.limit_chat_messages() from public,anon,authenticated;
create trigger crossa_message_rate_limit before insert on public.messages for each row execute function private.limit_chat_messages();

create function public.send_chat_message(p_request_id uuid,p_body text,p_client_id uuid)
returns setof public.messages language plpgsql security invoker set search_path = '' as $$
declare v_message public.messages;
begin
  if auth.uid() is null or p_client_id is null then raise exception 'Sign in before sending a message.'; end if;
  if not private.can_open_chat(p_request_id) then raise exception 'Conversation unavailable.'; end if;
  if char_length(trim(coalesce(p_body,''))) not between 1 and 2000 then raise exception 'Use between 1 and 2000 characters.'; end if;
  -- The same client ID is reused on retry. A lost HTTP response cannot create a second message.
  select * into v_message from public.messages m where m.id=p_client_id and m.sender_id=auth.uid()
    and m.request_id=p_request_id and m.body=trim(p_body);
  if found then return next v_message; return; end if;
  insert into public.messages(id,request_id,sender_id,body) values(p_client_id,p_request_id,auth.uid(),trim(p_body))
    on conflict(id) do nothing returning * into v_message;
  if not found then
    select * into v_message from public.messages m where m.id=p_client_id and m.sender_id=auth.uid()
      and m.request_id=p_request_id and m.body=trim(p_body);
    if not found then raise exception 'This message could not be sent. Please try again.'; end if;
  end if;
  return next v_message;
end;
$$;

create function public.conversation_messages(p_request_id uuid,p_before timestamptz default null,p_before_id uuid default null,p_search text default '',p_limit integer default 41)
returns setof public.messages language plpgsql stable security invoker set search_path = '' as $$
begin
  if not private.can_open_chat(p_request_id) then raise exception 'Conversation unavailable.'; end if;
  return query select m.* from public.messages m where m.request_id=p_request_id
    and (p_before is null or (m.created_at,m.id)<(p_before,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    and (coalesce(trim(p_search),'')='' or strpos(lower(m.body),lower(left(trim(p_search),100)))>0)
    order by m.created_at desc,m.id desc limit greatest(1,least(coalesce(p_limit,41),101));
end;
$$;

create table public.conversation_activity (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.connection_requests(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  typing_until timestamptz not null default now(),
  unique(request_id,user_id)
);
create function public.conversation_messages_after(p_request_id uuid,p_after timestamptz,p_after_id uuid,p_limit integer default 101)
returns setof public.messages language plpgsql stable security invoker set search_path = '' as $$
begin
  if not private.can_open_chat(p_request_id) then raise exception 'Conversation unavailable.'; end if;
  return query select m.* from public.messages m where m.request_id=p_request_id and (m.created_at,m.id)>(p_after,p_after_id)
    order by m.created_at,m.id limit greatest(1,least(coalesce(p_limit,101),101));
end;
$$;
revoke all on function public.conversation_messages_after(uuid,timestamptz,uuid,integer) from public,anon;
grant execute on function public.conversation_messages_after(uuid,timestamptz,uuid,integer) to authenticated;
alter table public.conversation_activity enable row level security;
revoke all on public.conversation_activity from public,anon,authenticated;
grant select on public.conversation_activity to authenticated;
create policy activity_participants on public.conversation_activity for select to authenticated using(private.can_open_chat(request_id));

create function public.set_conversation_typing(p_request_id uuid,p_typing boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_open_chat(p_request_id) then raise exception 'Conversation unavailable.'; end if;
  insert into public.conversation_activity(request_id,user_id,typing_until)
    values(p_request_id,auth.uid(),case when p_typing then now()+interval '8 seconds' else now() end)
    on conflict(request_id,user_id) do update set typing_until=excluded.typing_until
      where not p_typing or conversation_activity.typing_until<now()+interval '5 seconds';
end;
$$;

create function public.conversation_state(p_request_id uuid)
returns table(peer_read_at timestamptz,typing_until timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_open_chat(p_request_id) then raise exception 'Conversation unavailable.'; end if;
  return query select case when r.sender_id=auth.uid() then r.recipient_read_at else r.sender_read_at end,a.typing_until
    from public.connection_requests r left join public.conversation_activity a on a.request_id=r.id and a.user_id<>auth.uid()
    where r.id=p_request_id;
end;
$$;
create or replace function public.mark_conversation_read(p_request_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_open_chat(p_request_id) then return false; end if;
  update public.connection_requests r set
    sender_read_at=case when r.sender_id=auth.uid() then now() else r.sender_read_at end,
    recipient_read_at=case when r.recipient_id=auth.uid() then now() else r.recipient_read_at end
    where r.id=p_request_id;
  return found;
end;
$$;

alter table public.profile_reports
  add column category text not null default 'other' check(category in ('spam','harassment','inappropriate','impersonation','safety','other')),
  add column details text not null default '' check(char_length(details)<=1000),
  add column status text not null default 'open' check(status in ('open','reviewing','resolved','dismissed')),
  add column moderator_note text not null default '' check(char_length(moderator_note)<=1000),
  add column reviewed_by uuid references auth.users(id) on delete set null,
  add column reviewed_at timestamptz;
create index reports_queue_idx on public.profile_reports(status,created_at desc,id desc);
create index reports_reporter_recent_idx on public.profile_reports(reporter_id,created_at desc);
create table private.moderators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table private.moderators enable row level security;
revoke all on private.moderators from public,anon,authenticated;
create function public.is_crossa_moderator()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.moderators m join public.profiles p on p.id=m.user_id
    where m.user_id=auth.uid() and p.account_status='active');
$$;

-- Reporting goes through a checked RPC; direct INSERT would bypass duplicate/rate checks.
revoke insert on public.profile_reports from authenticated;
revoke select on public.profile_reports from authenticated;
grant select(id,reporter_id,reported_user,reason,category,details,status,created_at) on public.profile_reports to authenticated;
drop policy reports_insert_reporter on public.profile_reports;
create function public.submit_profile_report(p_profile_id uuid,p_category text,p_details text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null or not public.my_account_is_active() then raise exception 'Sign in before reporting.'; end if;
  if p_profile_id is null or p_profile_id=auth.uid() then raise exception 'Choose another profile.'; end if;
  if p_category is null or p_category not in ('spam','harassment','inappropriate','impersonation','safety','other') then raise exception 'Choose a report category.'; end if;
  if char_length(coalesce(p_details,''))>1000 then raise exception 'Keep report details under 1000 characters.'; end if;
  if not exists(select 1 from public.profiles p where p.id=p_profile_id) then raise exception 'Profile unavailable.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('crossa-reports:'||auth.uid()::text,0));
  select r.id into v_id from public.profile_reports r where r.reporter_id=auth.uid() and r.reported_user=p_profile_id
    and r.category=p_category and r.status in ('open','reviewing') order by r.created_at desc limit 1;
  if found then return v_id; end if;
  if (select count(*) from public.profile_reports r where r.reporter_id=auth.uid() and r.created_at>now()-interval '1 hour')>=5 then
    raise exception 'You have submitted several reports. Please try again later.';
  end if;
  insert into public.profile_reports(reporter_id,reported_user,reason,category,details)
    values(auth.uid(),p_profile_id,p_category,p_category,trim(coalesce(p_details,''))) returning id into v_id;
  return v_id;
end;
$$;
create or replace function public.report_profile(p_profile_id uuid,p_reason text default 'profile')
returns uuid language sql security invoker set search_path = '' as $$
  select public.submit_profile_report(p_profile_id,case when p_reason in ('spam','harassment','inappropriate','impersonation','safety') then p_reason else 'other' end,'');
$$;

create function public.moderation_reports(p_status text default 'open',p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 31)
returns table(id uuid,reported_user uuid,reported_name text,reporter_name text,category text,details text,status text,moderator_note text,created_at timestamptz,reviewed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_crossa_moderator() then raise exception 'Moderator access required.'; end if;
  return query select r.id,r.reported_user,p.display_name,reporter.display_name,r.category,r.details,r.status,r.moderator_note,r.created_at,r.reviewed_at
    from public.profile_reports r join public.profiles p on p.id=r.reported_user join public.profiles reporter on reporter.id=r.reporter_id
    where r.status=p_status and (p_before is null or (r.created_at,r.id)<(p_before,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by r.created_at desc,r.id desc limit greatest(1,least(coalesce(p_limit,31),101));
end;
$$;
create function public.review_profile_report(p_report_id uuid,p_status text,p_note text default '')
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_crossa_moderator() then raise exception 'Moderator access required.'; end if;
  if p_status is null or p_status not in ('reviewing','resolved','dismissed') then raise exception 'Choose a review status.'; end if;
  if char_length(coalesce(p_note,''))>1000 then raise exception 'Keep review notes under 1000 characters.'; end if;
  update public.profile_reports r set status=p_status,moderator_note=trim(coalesce(p_note,'')),reviewed_by=auth.uid(),reviewed_at=now()
    where r.id=p_report_id;
  return found;
end;
$$;

revoke all on function public.cancel_connection_request(uuid),public.my_sent_requests(integer),
  public.send_chat_message(uuid,text,uuid),public.conversation_messages(uuid,timestamptz,uuid,text,integer),
  public.set_conversation_typing(uuid,boolean),public.conversation_state(uuid),public.is_crossa_moderator(),
  public.submit_profile_report(uuid,text,text),public.moderation_reports(text,timestamptz,uuid,integer),public.review_profile_report(uuid,text,text)
  from public,anon;
grant execute on function public.cancel_connection_request(uuid),public.my_sent_requests(integer),
  public.send_chat_message(uuid,text,uuid),public.conversation_messages(uuid,timestamptz,uuid,text,integer),
  public.set_conversation_typing(uuid,boolean),public.conversation_state(uuid),public.is_crossa_moderator(),
  public.submit_profile_report(uuid,text,text),public.moderation_reports(text,timestamptz,uuid,integer),public.review_profile_report(uuid,text,text)
  to authenticated;

do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.connection_requests,public.conversation_activity;
  end if;
end;
$$;
