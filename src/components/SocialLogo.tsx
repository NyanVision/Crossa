import React from "react";
import { FontAwesome6 } from "@expo/vector-icons";
import { useTheme } from "@/context/AppearanceContext";
import type { SocialPlatform } from "@/types";

const icons = {
  facebook: "facebook", instagram: "instagram", tiktok: "tiktok",
  x: "x-twitter", telegram: "telegram", line: "line",
  whatsapp: "whatsapp", wechat: "weixin",
} as const;
const brandColors: Partial<Record<SocialPlatform, string>> = {
  facebook: "#1877F2", instagram: "#C13584", telegram: "#229ED9",
  line: "#06C755", whatsapp: "#25D366", wechat: "#07C160",
};

export function SocialLogo({ platform, size = 24 }: { platform: SocialPlatform; size?: number }) {
  const { colors } = useTheme();
  return <FontAwesome6 name={icons[platform]} iconStyle="brands" size={size} color={brandColors[platform] ?? colors.text} />;
}
