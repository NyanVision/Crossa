import type { ChatMessage, InboxConversation, InboxStatus } from "@/types";
import { requireSupabase } from "@/services/supabase";
import { signedProfilePhotoUrl } from "@/services/profileStorage";

interface InboxRow {
  id: string;
  profile_id: string;
  display_name: string;
  photo_path: string | null;
  status: InboxStatus;
  first_message: string | null;
  last_message: string | null;
  updated_at: string;
  unread_count: number;
  profile_preview: { bio?: string | null; genderLabel?: string | null } | null;
}

export async function loadInbox(): Promise<InboxConversation[]> {
  const { data, error } = await requireSupabase().rpc("my_inbox");
  if (error) throw error;
  const rows = (data ?? []) as InboxRow[];
  return Promise.all(rows.map(async (row) => ({
    id: row.id,
    profileId: row.profile_id,
    displayName: row.display_name,
    photoUri: await signedProfilePhotoUrl(row.photo_path).catch(() => null),
    lastMessage: row.last_message ?? "",
    updatedAt: row.updated_at,
    unreadCount: Number(row.unread_count ?? 0),
    status: row.status,
    messages: [],
    firstMessage: row.first_message ?? "",
    profilePreview: {
      bio: row.profile_preview?.bio ?? "",
      interests: [],
    },
  })));
}

export async function loadInboxByStatus(status: InboxStatus): Promise<InboxConversation[]> {
  return (await loadInbox()).filter((conversation) => conversation.status === status);
}

export async function acceptInboxRequest(id: string): Promise<boolean> {
  const { data, error } = await requireSupabase().rpc("respond_to_connection_request", {
    p_request_id: id,
    p_accept: true,
  });
  if (error) throw error;
  return data === true;
}

export async function declineInboxRequest(id: string): Promise<void> {
  const { data, error } = await requireSupabase().rpc("respond_to_connection_request", {
    p_request_id: id,
    p_accept: false,
  });
  if (error) throw error;
  if (data !== true) throw new Error("This request has already been handled.");
}

export async function markInboxConversationRead(id: string): Promise<void> {
  const { error } = await requireSupabase().rpc("mark_conversation_read", { p_request_id: id });
  if (error) throw error;
}

export interface MessageCursor { createdAt: string; id: string }
export interface MessagePage { messages: ChatMessage[]; hasOlder: boolean; cursor: MessageCursor | null }
export async function loadConversationMessages(requestId: string, before?: MessageCursor | null, search = ""): Promise<MessagePage> {
  const client = requireSupabase();
  const [{ data: { user }, error: authError }, { data, error }] = await Promise.all([
    client.auth.getUser(),
    client.rpc("conversation_messages", { p_request_id: requestId, p_before: before?.createdAt ?? null,
      p_before_id: before?.id ?? null, p_search: search.trim(), p_limit: 41 }),
  ]);
  if (authError) throw authError;
  if (error) throw error;
  if (!user) throw new Error("Sign in again to open this conversation.");
  const rows = (data ?? []).slice(0, 40) as { id: string; sender_id: string; body: string; created_at: string }[];
  const oldest = rows.at(-1);
  return {
    hasOlder: (data?.length ?? 0) > 40,
    cursor: oldest ? { id: oldest.id, createdAt: oldest.created_at } : null,
    messages: rows.reverse().map((row) => ({
      id: row.id,
      from: row.sender_id === user.id ? "me" : "them",
      text: row.body,
      createdAt: row.created_at,
    })),
  };
}

export async function appendInboxMessage(requestId: string, text: string, clientId: string): Promise<ChatMessage> {
  const client = requireSupabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  if (!user) throw new Error("Sign in again to send a message.");
  const { data, error } = await client.rpc("send_chat_message", {
    p_request_id: requestId, p_body: text.trim(), p_client_id: clientId,
  }).single();
  if (error) throw error;
  const row = data as { id: string; body: string; created_at: string };
  return { id: row.id, from: "me", text: row.body, createdAt: row.created_at };
}

export async function loadConversationState(requestId: string): Promise<{ peerReadAt: string | null; typingUntil: string | null }> {
  const { data, error } = await requireSupabase().rpc("conversation_state", { p_request_id: requestId }).single();
  if (error) throw error;
  const row = data as { peer_read_at: string | null; typing_until: string | null };
  return { peerReadAt: row.peer_read_at, typingUntil: row.typing_until };
}

export async function loadConversationUpdates(requestId: string, after: MessageCursor): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
  const client = requireSupabase();
  const [{ data: { user }, error: authError }, { data, error }] = await Promise.all([
    client.auth.getUser(), client.rpc("conversation_messages_after", {
      p_request_id: requestId, p_after: after.createdAt, p_after_id: after.id, p_limit: 101,
    }),
  ]);
  if (authError) throw authError;
  if (error) throw error;
  if (!user) throw new Error("Sign in again to open this conversation.");
  const rows = (data ?? []).slice(0, 100) as { id: string; sender_id: string; body: string; created_at: string }[];
  return { hasMore: (data?.length ?? 0) > 100, messages: rows.map((row) => ({ id: row.id, from: row.sender_id === user.id ? "me" : "them", text: row.body, createdAt: row.created_at })) };
}

export async function setConversationTyping(requestId: string, typing: boolean): Promise<void> {
  const { error } = await requireSupabase().rpc("set_conversation_typing", { p_request_id: requestId, p_typing: typing });
  if (error) throw error;
}

/** Blocking removes access server-side; the inbox RPC will omit the row on the next refresh. */
export async function removeInboxConversation(_id: string): Promise<void> {
  return;
}
