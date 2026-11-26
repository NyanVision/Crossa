# Messaging, requests, and report review

This release fixes the unreadable unselected gender/audience options in dark mode.
Both selected and unselected rows use theme colors, body labels meet 4.5:1
contrast in both themes, and options have at least 48-point touch targets.

## Inbox and requests

The inbox subscribes to authorized message and request changes. It refreshes
on foregrounding and uses a foreground-only fallback every 15 seconds to
recover missed events. Errors preserve the existing list and show Retry.
Pull to refresh and search are available. The tab badge counts unread chats
and incoming requests.

The Sent tab shows the 200 most recent outgoing requests, including pending,
accepted, declined, and cancelled states. Only the sender can cancel a pending
request. A cancellation cannot undo acceptance. The server prevents resending
for 24 hours after a decline and 5 minutes after cancellation. Existing
accepted connections continue to open as chats.

## Chat

Messages load in pages of 40 using a timestamp/ID cursor, so equal timestamps
cannot skip messages. Search matches text within the current conversation,
including older history. HTTP responses and Realtime events merge by message ID.
Retries reuse a client-issued UUID, preventing duplicates when a response is lost.
The composer retains the message after a send failure. Reconnecting fetches
missed messages in cursor order; very large gaps reload a contiguous recent page.

Typing state is participant-only and expires after 8 seconds without refresh.
Leaving the screen or backgrounding clears local typing state. Read timestamps
change only for the caller. A chat marks read only while focused, foregrounded,
outside search, and at the bottom. The last outgoing bubble shows Sent or Seen.

## Abuse controls

| Action | Server limit |
|---|---|
| Connection requests | 10/minute and 50/24 hours per sender |
| Chat messages | 30/minute and 500/hour per sender |
| New reports | 5/hour per reporter |

Per-user transaction locks serialize rate checks. Message limits also apply
to direct table inserts, and client timestamps cannot bypass them. Repeated
submissions of the same unresolved report/category return the existing report.
These limits are enforced in the database, independently of UI controls.

## Reporting and moderation

Report actions in profiles, requests, inbox menus, and chats open the same
category/detail form. Categories cover spam, harassment, inappropriate content,
impersonation, safety, and other issues. Details are limited to 1000 characters.

Accounts explicitly listed in `private.moderators` see **Settings → Review reports**.
The queue is paginated and filters open, reviewing, resolved, and dismissed reports.
Reviewers can add notes and change review status. This queue records review work;
it does not automatically suspend accounts or delete user content.

Membership is assigned by a trusted project administrator, never from
user-editable profile metadata. Once the intended operator's Crossa login
email is known, a project administrator can run this query with that email:

```sql
insert into private.moderators(user_id)
select id from auth.users where lower(email)=lower('YOUR_CROSSA_LOGIN_EMAIL')
on conflict(user_id) do nothing;
```

Client roles cannot read or write the membership table. Moderator RPCs check
membership and active account status on every call. Reporters cannot read
internal moderator notes or reviewer IDs.

## Deployment

1. Apply the repository migrations in order. The discovery repair migration
   matches an already deployed repair; preserve its existing history entry.
2. Deploy `register-push-device` and `dispatch-push`. Registration performs its
   own Auth-server verification, including modern signing keys. The worker
   accepts only its private credential; it is not an unauthenticated endpoint.
3. Run `select public.configure_crossa_push('https://YOUR_PROJECT_REF.supabase.co');`
   as the project administrator. It creates the needed extensions, keeps the
   random credential inside Vault, and schedules delivery every minute.
   The supplied URL must be an actual 20-character Supabase project reference.
4. Verify Cron runs and `net._http_response` status codes. Keep credentials
   and full request headers out of logs and screenshots.
5. Configure APNs/FCM credentials for the existing Expo project, and install
   a new native build. A JavaScript export does not verify delivery on phones.
6. Grant report-review access only to the intended existing Crossa account.

The same deployment is available through `npm run push:deploy -- --project-ref YOUR_PROJECT_REF`.
Physical-device tests should cover two accounts, opt-in/out, requests,
acceptance/cancellation races, background/foreground delivery, message retries,
read state, typing expiry, report review, blocking, and account switching.

## Automated verification

Run `npm run typecheck`, `npm run lint`, and `npm test`. The database tests replay
the full migration history in embedded Postgres. They cover permissions,
cooldowns, cancellation ownership, rate limits, duplicate sends, cursor paging,
literal/case-insensitive search, blocked chats, typing expiry, read ownership,
report throttling, moderator privilege escalation, and scheduler access.
Contrast tests evaluate the actual form's rendered choice styles in both themes.
The existing CI also typechecks push functions and exports both native bundles.
