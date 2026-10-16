// Shared design tokens — mirrors the Crossa web prototype's palette.
// Light and dark palettes share the same token names so every screen can
// read colors from the active theme instead of hard-coding hex values.
export interface Palette {
  background: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  muted: string;
  accent: string;
  accentInk: string;
  accentSoft: string;
  accentSoftBorder: string;
  border: string;
  borderSoft: string;
  danger: string;
  dangerSoft: string;
  dangerSoftBorder: string;
  dangerText: string;
  success: string;
  successSoft: string;
  successSoftBorder: string;
  successIcon: string;
  badge: string;
  bannerBg: string;
  overlayInk: string;
  qrPaper: string;
}

export const lightColors: Palette = {
  background: "#F5F6F7",
  surface: "#FFFFFF",
  surfaceAlt: "#FAFBFC",
  text: "#20262D",
  muted: "#66717D",
  accent: "#496C89",
  accentInk: "#FFFFFF",
  accentSoft: "#EAF0F4",
  accentSoftBorder: "#C7D4DE",
  border: "#DCE1E5",
  borderSoft: "#E9EDF0",
  danger: "#B3452E",
  dangerSoft: "#FFF2F0",
  dangerSoftBorder: "#F5D6D0",
  dangerText: "#8A3C32",
  success: "#5F7A4F",
  successSoft: "#F0F4EA",
  successSoftBorder: "#E0E8D7",
  successIcon: "#E2EAD9",
  badge: "#E8DFD4",
  bannerBg: "#F1F4F6",
  overlayInk: "#171512",
  qrPaper: "#FFFFFF",
};

export const darkColors: Palette = {
  background: "#12161A",
  surface: "#1B2127",
  surfaceAlt: "#171C21",
  text: "#ECEFF2",
  muted: "#9AA5B1",
  accent: "#7FA6C6",
  accentInk: "#0F1418",
  accentSoft: "#243240",
  accentSoftBorder: "#3A5168",
  border: "#2E3740",
  borderSoft: "#252D35",
  danger: "#E0735C",
  dangerSoft: "#2E1D1A",
  dangerSoftBorder: "#5A2F28",
  dangerText: "#F0A89A",
  success: "#8FB07A",
  successSoft: "#1D2619",
  successSoftBorder: "#2D3B27",
  successIcon: "#273321",
  badge: "#3A342C",
  bannerBg: "#1F262C",
  overlayInk: "#0A0C0E",
  qrPaper: "#FFFFFF",
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const radii = { sm: 10, md: 12, lg: 14, pill: 999 };

export const type = {
  h1: { fontSize: 24, fontWeight: "800" as const },
  h2: { fontSize: 18, fontWeight: "800" as const },
  body: { fontSize: 15, fontWeight: "400" as const },
  label: { fontSize: 12.5, fontWeight: "700" as const },
  caption: { fontSize: 12, fontWeight: "500" as const },
};
