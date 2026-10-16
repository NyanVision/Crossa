import type { SocialPlatform } from "@/types";

const RESERVED_FACEBOOK_PATHS = new Set(["watch", "groups", "marketplace", "gaming", "events", "help", "privacy", "policies", "business"]);

/** Returns a validated canonical public URL; null means the value is incomplete or unsafe. */
export function socialProfileUrl(platform: SocialPlatform, raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const input = value.replace(/^@/, "");
  const explicitUrl = /^https?:\/\//i.test(value);
  if (!explicitUrl && !/[/:?#]/.test(input)) {
    switch (platform) {
      case "instagram": return /^[A-Za-z0-9._]{1,64}$/.test(input) && !input.includes("..") ? `https://instagram.com/${encodeURIComponent(input)}` : null;
      case "telegram": return /^[A-Za-z0-9_]{5,32}$/.test(input) ? `https://t.me/${encodeURIComponent(input)}` : null;
      case "x": return /^[A-Za-z0-9._]{1,15}$/.test(input) && !input.includes("..") ? `https://x.com/${encodeURIComponent(input)}` : null;
      case "tiktok": return /^@?[A-Za-z0-9._]{2,24}$/.test(input) ? `https://www.tiktok.com/@${encodeURIComponent(input.replace(/^@/, ""))}` : null;
      case "facebook": return /^[A-Za-z0-9.]{5,50}$/.test(input) && !RESERVED_FACEBOOK_PATHS.has(input.toLowerCase()) ? `https://www.facebook.com/${encodeURIComponent(input)}` : null;
      case "whatsapp": { const number = input.replace(/\D/g, ""); return number.length >= 8 && number.length <= 15 && !number.startsWith("0") ? `https://wa.me/${number}` : null; }
      default: break;
    }
  }
  const urlValue = /^(?:(?:www|m)\.)?(?:facebook\.com|instagram\.com|tiktok\.com|x\.com|twitter\.com|t\.me|telegram\.me|wa\.me|line\.me)\//i.test(value) ? `https://${value}` : value;
  let parsed: URL;
  try { parsed = new URL(urlValue); } catch { return null; }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password || parsed.port) return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\.(?=facebook\.com$)/, "");
  const path = parsed.pathname.replace(/^\/+|\/+$/g, "");
  const parts = path.split("/").filter(Boolean);
  const validHandle = (handle: string) => /^[A-Za-z0-9._]{1,64}$/.test(handle) && !handle.includes("..");
  switch (platform) {
    case "instagram":
      if (host !== "instagram.com" || parts.length !== 1 || !validHandle(parts[0])) return null;
      return `https://instagram.com/${encodeURIComponent(parts[0])}`;
    case "telegram":
      if (!["t.me", "telegram.me"].includes(host) || parts.length !== 1 || !/^[A-Za-z0-9_]{5,32}$/.test(parts[0])) return null;
      return `https://t.me/${encodeURIComponent(parts[0])}`;
    case "whatsapp": {
      const number = (host === "wa.me" ? path : value).replace(/\D/g, "");
      if (host !== "wa.me" && !/^\+?[0-9 ()-]+$/.test(value)) return null;
      if (number.length < 8 || number.length > 15 || number.startsWith("0")) return null;
      return `https://wa.me/${number}`;
    }
    case "x":
      if (!["x.com", "twitter.com"].includes(host) || parts.length !== 1 || !/^[A-Za-z0-9._]{1,15}$/.test(parts[0]) || parts[0].includes("..")) return null;
      return `https://x.com/${encodeURIComponent(parts[0])}`;
    case "tiktok":
      if (host !== "tiktok.com" || parts.length !== 1 || !/^@[A-Za-z0-9._]{2,24}$/.test(parts[0])) return null;
      return `https://www.tiktok.com/@${encodeURIComponent(parts[0].slice(1))}`;
    case "facebook": {
      if (host !== "facebook.com") return null;
      if (parts.length === 1 && parts[0]?.toLowerCase() === "profile.php") {
        const id = parsed.searchParams.get("id");
        return id && /^[0-9]{5,32}$/.test(id) ? `https://www.facebook.com/profile.php?id=${id}` : null;
      }
      if (parts.length !== 1 || !/^[A-Za-z0-9.]{5,50}$/.test(parts[0]) || RESERVED_FACEBOOK_PATHS.has(parts[0].toLowerCase())) return null;
      return `https://www.facebook.com/${encodeURIComponent(parts[0])}`;
    }
    case "line":
      if (!/^https?:\/\//i.test(value)) return `https://line.me/R/ti/p/~${encodeURIComponent(value)}`;
      return host === "line.me" ? parsed.toString() : null;
    case "wechat":
      return null;
  }
}
