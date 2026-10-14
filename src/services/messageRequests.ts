import { requireSupabase } from "@/services/supabase";

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
