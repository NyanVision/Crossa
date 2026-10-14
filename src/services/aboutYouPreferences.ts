import { requireSupabase } from "@/services/supabase";

export type GenderOption = "Woman" | "Man" | "Non-binary" | "Self-describe" | "Prefer not to say";
export type MeetingOption = "Women" | "Men" | "Non-binary people" | "Everyone";

export interface AboutYouPreferences {
  gender: GenderOption | null;
  genderDescription: string;
  showGenderOnProfile: boolean;
  meeting: MeetingOption[];
}

const GENDERS: GenderOption[] = ["Woman", "Man", "Non-binary", "Self-describe", "Prefer not to say"];
const MEETING_OPTIONS: MeetingOption[] = ["Women", "Men", "Non-binary people", "Everyone"];

export function emptyAboutYouPreferences(): AboutYouPreferences {
  return { gender: null, genderDescription: "", showGenderOnProfile: false, meeting: [] };
}

export async function loadAboutYouPreferences(userId: string | null): Promise<AboutYouPreferences> {
  if (!userId) return emptyAboutYouPreferences();
  const { data, error } = await requireSupabase().from("profiles")
    .select("gender,gender_description,show_gender,meet_preferences")
    .eq("id", userId).maybeSingle();
  if (error) throw error;
  if (!data) return emptyAboutYouPreferences();
  const gender = GENDERS.includes(data.gender as GenderOption) ? data.gender as GenderOption : null;
  const meeting = Array.isArray(data.meet_preferences)
    ? MEETING_OPTIONS.filter((option) => data.meet_preferences.includes(option))
    : [];
  const genderDescription = typeof data.gender_description === "string" ? data.gender_description.trim().slice(0, 48) : "";
  const showGenderOnProfile = data.show_gender === true
    && gender !== null
    && gender !== "Prefer not to say"
    && (gender !== "Self-describe" || genderDescription.length > 0);
  return { gender, genderDescription, showGenderOnProfile, meeting };
}

export async function saveAboutYouPreferences(userId: string | null, value: AboutYouPreferences): Promise<void> {
  if (!userId) throw new Error("Sign in before saving these preferences.");
  const gender = GENDERS.includes(value.gender as GenderOption) ? value.gender : null;
  const meeting = MEETING_OPTIONS.filter((option) => value.meeting.includes(option));
  const genderDescription = gender === "Self-describe" ? value.genderDescription.trim().slice(0, 48) : "";
  const showGenderOnProfile = value.showGenderOnProfile
    && gender !== null
    && gender !== "Prefer not to say"
    && (gender !== "Self-describe" || genderDescription.length > 0);
  const { error } = await requireSupabase().from("profiles").update({
    gender,
    gender_description: genderDescription,
    show_gender: showGenderOnProfile,
    meet_preferences: meeting,
    updated_at: new Date().toISOString(),
  }).eq("id", userId);
  if (error) throw error;
}

export function visibleGenderLabel(value: AboutYouPreferences): string | null {
  if (!value.showGenderOnProfile || !value.gender || value.gender === "Prefer not to say") return null;
  return value.gender === "Self-describe" ? value.genderDescription.trim() || null : value.gender;
}
