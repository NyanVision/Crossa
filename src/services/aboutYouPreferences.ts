import { supabase } from "@/lib/supabase";

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
  const { data, error } = await supabase.from('profiles').select('about_you').eq('id', userId).maybeSingle();
  if (error) throw error;
  const saved = (data?.about_you ?? {}) as Partial<AboutYouPreferences>;
  const gender = GENDERS.includes(saved.gender as GenderOption) ? saved.gender as GenderOption : null;
  const meeting = Array.isArray(saved.meeting)
    ? MEETING_OPTIONS.filter((option) => saved.meeting?.includes(option))
    : [];
  const genderDescription = typeof saved.genderDescription === "string" ? saved.genderDescription.trim().slice(0, 48) : "";
  const showGenderOnProfile = saved.showGenderOnProfile === true
    && gender !== null
    && gender !== "Prefer not to say"
    && (gender !== "Self-describe" || genderDescription.length > 0);
  return { gender, genderDescription, showGenderOnProfile, meeting };
}

export async function saveAboutYouPreferences(userId: string | null, value: AboutYouPreferences): Promise<void> {
  const gender = GENDERS.includes(value.gender as GenderOption) ? value.gender : null;
  const meeting = MEETING_OPTIONS.filter((option) => value.meeting.includes(option));
  const genderDescription = value.gender === "Self-describe" ? value.genderDescription.trim().slice(0, 48) : "";
  const showGenderOnProfile = value.showGenderOnProfile
    && gender !== null
    && gender !== "Prefer not to say"
    && (gender !== "Self-describe" || genderDescription.length > 0);
  if (!userId) throw new Error('Sign in to save your preferences.');
  const { error } = await supabase.from('profiles').upsert({ id: userId, about_you: { gender, genderDescription, showGenderOnProfile, meeting } });
  if (error) throw error;
}

export function visibleGenderLabel(value: AboutYouPreferences): string | null {
  if (!value.showGenderOnProfile || !value.gender || value.gender === "Prefer not to say") return null;
  return value.gender === "Self-describe" ? value.genderDescription.trim() || null : value.gender;
}
