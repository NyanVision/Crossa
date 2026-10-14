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
    photoUri: await signedProfilePhotoUrl(row.photo_path),
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

export async function loadConversationMessages(requestId: string): Promise<ChatMessage[]> {
  const client = requireSupabase();
  const [{ data: { user }, error: authError }, { data, error }] = await Promise.all([
    client.auth.getUser(),
    client.from("messages").select("id,sender_id,body,created_at")
      .eq("request_id", requestId).order("created_at", { ascending: true }),
  ]);
  if (authError) throw authError;
  if (error) throw error;
  if (!user) throw new Error("Sign in again to open this conversation.");
  return (data ?? []).map((row) => ({
    id: row.id,
    from: row.sender_id === user.id ? "me" : "them",
    text: row.body,
    createdAt: row.created_at,
  }));
}

export async function appendInboxMessage(requestId: string, text: string): Promise<ChatMessage> {
  const client = requireSupabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  if (!user) throw new Error("Sign in again to send a message.");
  const { data, error } = await client.from("messages").insert({
    request_id: requestId,
    sender_id: user.id,
    body: text.trim(),
  }).select("id,sender_id,body,created_at").single();
  if (error) throw error;
  return { id: data.id, from: "me", text: data.body, createdAt: data.created_at };
}

/** Blocking removes access server-side; the inbox RPC will omit the row on the next refresh. */
export async function removeInboxConversation(_id: string): Promise<void> {
  return;
}
