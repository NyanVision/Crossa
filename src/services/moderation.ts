import { requireSupabase } from "@/services/supabase";

export type ModeratorRole = "moderator" | "admin";
export type ModerationAction = "dismiss" | "warn" | "suspend";

export interface ModerationReport {
  id: string;
  reporter_id: string;
  reported_user: string;
  reason: string;
  created_at: string;
}

export async function loadModeratorRole(): Promise<ModeratorRole | null> {
  const { data, error } = await requireSupabase().rpc("my_moderator_role");
  if (error) throw error;
  return data === "moderator" || data === "admin" ? data : null;
}

export async function loadModerationQueue(): Promise<ModerationReport[]> {
  const { data, error } = await requireSupabase().rpc("moderation_report_queue", { p_limit: 50 });
  if (error) throw error;
  return Array.isArray(data) ? data as ModerationReport[] : [];
}

export async function resolveModerationReport(report: ModerationReport, action: ModerationAction): Promise<boolean> {
  const note = `Report ${report.id.slice(0, 8)}: ${report.reason}`.slice(0, 1000);
  const { data, error } = await requireSupabase().rpc("moderate_profile_report", {
    p_report_id: report.id,
    p_action: action,
    p_note: note,
  });
  if (error) throw error;
  return data === true;
}
