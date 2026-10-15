import type { ChatMessage, InboxConversation, InboxStatus } from "@/types";
import { requireSupabase } from "@/services/supabase";
import { signedProfilePhotoUrl } from "@/services/profileStorage";
import * as Crypto from "expo-crypto";

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
export interface InboxCursor { updatedAt: string; id: string; }
export interface InboxPage { conversations: InboxConversation[]; nextCursor: InboxCursor | null; }
export interface MessageCursor { createdAt: string; id: string; }
export interface MessagePage { messages: ChatMessage[]; nextCursor: MessageCursor | null; }

async function mapInboxRows(rows: InboxRow[]): Promise<InboxConversation[]> {
  return Promise.all(rows.map(async (row) => ({
    id: row.id,
    profileId: row.profile_id,
    displayName: row.display_name,
    photoUri: await signedProfilePhotoUrl(row.photo_path),
    photoPath: row.photo_path,
    lastMessage: row.last_message ?? "",
    updatedAt: row.updated_at,
    unreadCount: Number(row.unread_count ?? 0),
    status: row.status,
    messages: [],
    firstMessage: row.first_message ?? "",
    profilePreview: { bio: row.profile_preview?.bio ?? "", interests: [] },
  })));
}

export async function loadInboxPage(cursor: InboxCursor | null = null, pageSize = 30): Promise<InboxPage> {
  const { data, error } = await requireSupabase().rpc("my_inbox", {
    p_before_updated_at: cursor?.updatedAt ?? null,
    p_before_id: cursor?.id ?? null,
    p_limit: Math.min(100, Math.max(1, pageSize)),
  });
  if (error) throw error;
  const rows = (data ?? []) as InboxRow[];
  return {
    conversations: await mapInboxRows(rows),
    nextCursor: rows.length === pageSize && rows.length ? { updatedAt: rows[rows.length - 1].updated_at, id: rows[rows.length - 1].id } : null,
  };
}

/** Compatibility helper for compact inbox/request views. Server still limits this to a page. */
export async function loadInbox(): Promise<InboxConversation[]> {
  return (await loadInboxPage(null, 100)).conversations;
}

export async function loadInboxByStatus(status: InboxStatus): Promise<InboxConversation[]> {
  return (await loadInbox()).filter((conversation) => conversation.status === status);
}

export async function acceptInboxRequest(id: string): Promise<boolean> {
  const { data, error } = await requireSupabase().rpc("respond_to_connection_request", { p_request_id: id, p_accept: true });
  if (error) throw error;
  return data === true;
}

export async function declineInboxRequest(id: string): Promise<void> {
  const { data, error } = await requireSupabase().rpc("respond_to_connection_request", { p_request_id: id, p_accept: false });
  if (error) throw error;
  if (data !== true) throw new Error("This request has already been handled.");
}

export async function markInboxConversationRead(id: string): Promise<void> {
  const { error } = await requireSupabase().rpc("mark_conversation_read", { p_request_id: id });
  if (error) throw error;
}

export async function loadConversationMessagesPage(requestId: string, cursor: MessageCursor | null = null, pageSize = 50): Promise<MessagePage> {
  const client = requireSupabase();
  const [{ data: { user }, error: authError }, { data, error }] = await Promise.all([
    client.auth.getUser(),
    client.rpc("list_conversation_messages", {
      p_request_id: requestId,
      p_before_created_at: cursor?.createdAt ?? null,
      p_before_id: cursor?.id ?? null,
      p_limit: Math.min(100, Math.max(1, pageSize)),
    }),
  ]);
  if (authError) throw authError;
  if (error) throw error;
  if (!user) throw new Error("Sign in again to open this conversation.");
  const rows = (data ?? []) as Array<{ id: string; sender_id: string; body: string; created_at: string; client_message_id: string | null }>;
  const messages = rows.map((row) => ({ id: row.id, from: row.sender_id === user.id ? "me" as const : "them" as const, text: row.body, createdAt: row.created_at })).reverse();
  const oldest = rows[rows.length - 1];
  return { messages, nextCursor: rows.length === pageSize && oldest ? { createdAt: oldest.created_at, id: oldest.id } : null };
}

export async function loadConversationMessages(requestId: string): Promise<ChatMessage[]> {
  return (await loadConversationMessagesPage(requestId, null, 50)).messages;
}

export async function appendInboxMessage(requestId: string, text: string, idempotencyKey = Crypto.randomUUID()): Promise<ChatMessage> {
  const client = requireSupabase();
  const { data, error } = await client.rpc("send_chat_message", {
    p_request_id: requestId,
    p_client_message_id: idempotencyKey,
    p_body: text.trim(),
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { id: string; sender_id: string; body: string; created_at: string } | null;
  if (!row) throw new Error("The server did not confirm the message.");
  return { id: row.id, from: "me", text: row.body, createdAt: row.created_at };
}

/** Hides this request/chat only from the current user's inbox; it does not erase history. */
export async function removeInboxConversation(id: string): Promise<void> {
  const { data, error } = await requireSupabase().rpc("set_conversation_hidden", { p_request_id: id, p_hidden: true });
  if (error) throw error;
  if (data !== true) throw new Error("Could not hide this conversation.");
}

export async function unhideInboxConversation(id: string): Promise<void> {
  const { data, error } = await requireSupabase().rpc("set_conversation_hidden", { p_request_id: id, p_hidden: false });
  if (error) throw error;
  if (data !== true) throw new Error("Could not restore this conversation.");
}
