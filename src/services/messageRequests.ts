import { requireSupabase } from "@/services/supabase";
import { signedProfilePhotoUrl } from "@/services/profileStorage";
import type { SentRequest, RequestStatus } from "@/types";

export interface OutgoingMessageRequest {
  profileId: string;
  displayName: string;
  createdAt: string;
}

export async function createMessageRequest(profileId: string, _displayName: string): Promise<boolean> {
  const { data, error } = await requireSupabase().rpc("send_connection_request", {
    p_recipient_id: profileId,
    p_initial_message: "",
  });
  if (error) throw error;
  return data === true;
}

export async function loadSentRequests(): Promise<SentRequest[]> {
  const { data, error } = await requireSupabase().rpc("my_sent_requests", { p_limit: 200 });
  if (error) throw error;
  return Promise.all((data ?? []).map(async (row: { id: string; profile_id: string; display_name: string; photo_path: string | null; status: RequestStatus; created_at: string; cooldown_until: string | null }) => ({
    id: row.id, profileId: row.profile_id, displayName: row.display_name,
    photoUri: await signedProfilePhotoUrl(row.photo_path).catch(() => null),
    status: row.status, createdAt: row.created_at, cooldownUntil: row.cooldown_until,
  })));
}

export async function cancelMessageRequest(id: string): Promise<void> {
  const { data, error } = await requireSupabase().rpc("cancel_connection_request", { p_request_id: id });
  if (error) throw error;
  if (data !== true) throw new Error("This request has already been handled. Refresh to see its current status.");
}
