import { requireSupabase } from "@/services/supabase";

export const reportCategories = [
  { value: "spam", label: "Spam or unwanted requests" },
  { value: "harassment", label: "Harassment or bullying" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "impersonation", label: "Fake profile or impersonation" },
  { value: "safety", label: "Threats or safety concern" },
  { value: "other", label: "Something else" },
] as const;
export type ReportCategory = typeof reportCategories[number]["value"];
export type ReportStatus = "open" | "reviewing" | "resolved" | "dismissed";
export interface ProfileReport {
  id: string; reported_user: string; reported_name: string; reporter_name: string;
  category: ReportCategory; details: string; status: ReportStatus; moderator_note: string;
  created_at: string; reviewed_at: string | null;
}

export async function submitProfileReport(profileId: string, category: ReportCategory, details: string): Promise<void> {
  const { error } = await requireSupabase().rpc("submit_profile_report", {
    p_profile_id: profileId, p_category: category, p_details: details.trim(),
  });
  if (error) throw error;
}
export async function isModerator(): Promise<boolean> {
  const { data, error } = await requireSupabase().rpc("is_crossa_moderator");
  if (error) throw error;
  return data === true;
}
export async function loadReports(status: ReportStatus, before?: ProfileReport): Promise<{ reports: ProfileReport[]; hasMore: boolean }> {
  const { data, error } = await requireSupabase().rpc("moderation_reports", {
    p_status: status, p_before: before?.created_at ?? null, p_before_id: before?.id ?? null, p_limit: 31,
  });
  if (error) throw error;
  return { reports: (data ?? []).slice(0, 30), hasMore: (data?.length ?? 0) > 30 };
}
export async function reviewReport(id: string, status: Exclude<ReportStatus, "open">, note: string): Promise<void> {
  const { data, error } = await requireSupabase().rpc("review_profile_report", { p_report_id: id, p_status: status, p_note: note.trim() });
  if (error) throw error;
  if (data !== true) throw new Error("This report is no longer available. Refresh and try again.");
}
