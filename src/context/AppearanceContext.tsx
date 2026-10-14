import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Appearance } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { darkColors, lightColors, type Palette } from "@/theme/colors";
import { useAuth } from "@/context/AuthContext";
import { loadUserSettings, saveUserSettings } from "@/services/userSettings";

export type AppearanceChoice = "light" | "dark" | "system";
export type ResolvedScheme = "light" | "dark";
const KEY = "catchya:appearance";

interface AppearanceValue {
  choice: AppearanceChoice;
  scheme: ResolvedScheme;
  colors: Palette;
  ready: boolean;
  setChoice: (choice: AppearanceChoice) => Promise<void>;
}
const Context = createContext<AppearanceValue | null>(null);

function applyNative(choice: AppearanceChoice) {
  Appearance.setColorScheme(choice === "system" ? "unspecified" : choice);
}

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const { userId } = useAuth();
  const [choice, setChoiceState] = useState<AppearanceChoice>("system");
  const [ready, setReady] = useState(false);
  const [deviceScheme, setDeviceScheme] = useState<ResolvedScheme>(Appearance.getColorScheme() === "dark" ? "dark" : "light");

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => setDeviceScheme(colorScheme === "dark" ? "dark" : "light"));
    let active = true;
    AsyncStorage.getItem(KEY).then((saved) => {
      if (!active) return;
      const next: AppearanceChoice = saved === "light" || saved === "dark" ? saved : "system";
      applyNative(next);
      setChoiceState(next);
      setDeviceScheme(Appearance.getColorScheme() === "dark" ? "dark" : "light");
    }).catch(() => undefined).finally(() => { if (active) setReady(true); });
    return () => { active = false; sub.remove(); };
  }, []);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    loadUserSettings(userId).then(async (settings) => {
      if (!active) return;
      applyNative(settings.appearance);
      setChoiceState(settings.appearance);
      try { await AsyncStorage.setItem(KEY, settings.appearance); } catch { /* cloud setting still applies */ }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [userId]);

  const setChoice = useCallback(async (next: AppearanceChoice) => {
    applyNative(next);
    setChoiceState(next);
    setDeviceScheme(Appearance.getColorScheme() === "dark" ? "dark" : "light");
    try { await AsyncStorage.setItem(KEY, next); } catch { /* choice still applies for this session */ }
    if (userId) await saveUserSettings(userId, { appearance: next });
  }, [userId]);

  const scheme: ResolvedScheme = choice === "system" ? deviceScheme : choice;
  const value = useMemo<AppearanceValue>(() => ({
    choice, scheme, ready, setChoice, colors: scheme === "dark" ? darkColors : lightColors,
  }), [choice, scheme, ready, setChoice]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAppAppearance() {
  const value = useContext(Context);
  if (!value) throw new Error("useAppAppearance must be inside AppearanceProvider");
  return value;
}

export function useTheme() {
  const { colors, scheme } = useAppAppearance();
  return { colors, scheme, isDark: scheme === "dark" };
}

export function useThemedStyles<T>(factory: (colors: Palette) => T): T {
  const { colors } = useAppAppearance();
  return useMemo(() => factory(colors), [colors]);
}
