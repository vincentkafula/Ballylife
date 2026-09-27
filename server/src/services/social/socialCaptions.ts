/**
 * Captions per platform, from one product. Each platform gets its own
 * tone, length limit and hashtag style:
 *   Facebook   friendly, link included (links are clickable), a few hashtags
 *   Instagram  links aren't clickable in captions -> "tap the link in bio", more hashtags
 *   Threads    500-character limit, short and punchy, 1-2 hashtags
 *   TikTok     short hook + hashtags (photo posts: title + description)
 *   LinkedIn   professional, no emoji runs, link included
 */
export type PlatformId = "facebook" | "instagram" | "threads" | "tiktok" | "linkedin";
export const PLATFORMS: PlatformId[] = ["facebook", "instagram", "threads", "tiktok", "linkedin"];

export interface SocialProduct {
  id: string; name: string; priceZar: number; compareAtZar: number | null;
  description: string; url: string; images: string[]; category: string | null;
}

const LIMITS: Record<PlatformId, number> = { facebook: 2000, instagram: 2200, threads: 500, tiktok: 2200, linkedin: 3000 };

const rand = (n: number) => `R${Math.round(n).toLocaleString("en-ZA")}`;

/** "Home & Décor" -> "HomeDecor"; keeps hashtags valid on every platform. */
function tag(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/&/g, "and").replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join("");
}

function hashtags(p: SocialProduct, max: number): string {
  const tags = ["Ballylife", "ShopOnline", "SouthAfrica", p.category ? tag(p.category) : "", "DeliveryIncluded", "OnlineShoppingSA", "NewArrivals"]
    .filter(Boolean).slice(0, max);
  return tags.map(t => `#${t}`).join(" ");
}

/** First sentence or two of the description, tidied, within `max` characters. */
function blurb(p: SocialProduct, max: number): string {
  const text = p.description.replace(/\s+/g, " ").replace(/Specifications:.*$/i, "").trim();
  if (!text || text.toLowerCase().startsWith(p.name.toLowerCase().slice(0, 20))) return "";
  const sentences = text.split(/(?<=[.!?])\s+/);
  let out = "";
  for (const s of sentences) { if ((out + " " + s).length > max) break; out = (out + " " + s).trim(); }
  return out || text.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

function priceLine(p: SocialProduct): string {
  return p.compareAtZar && p.compareAtZar > p.priceZar ? `${rand(p.priceZar)} (was ${rand(p.compareAtZar)})` : rand(p.priceZar);
}

const fit = (s: string, limit: number) => (s.length <= limit ? s : s.slice(0, limit - 1).replace(/\s+\S*$/, "") + "…");

export function captionFor(platform: PlatformId, p: SocialProduct): string {
  const price = priceLine(p);
  switch (platform) {
    case "facebook":
      return fit([`✨ New at Ballylife: ${p.name}`, blurb(p, 300), `💰 ${price} — delivery included`, `🛒 Shop now: ${p.url}`, hashtags(p, 4)].filter(Boolean).join("\n\n"), LIMITS.facebook);
    case "instagram":
      return fit([`✨ ${p.name}`, blurb(p, 400), `💰 ${price} · delivery included across South Africa`, `🛒 Tap the link in our bio to shop`, hashtags(p, 10)].filter(Boolean).join("\n\n"), LIMITS.instagram);
    case "threads":
      return fit([`New in: ${p.name} — ${price}, delivery included.`, p.url, hashtags(p, 2)].join("\n\n"), LIMITS.threads);
    case "tiktok":
      return fit([`${p.name} for ${price} 🔥 delivery included`, hashtags(p, 8)].join("\n\n"), LIMITS.tiktok);
    case "linkedin":
      return fit([`New at Ballylife: ${p.name}`, blurb(p, 500), `Price: ${price}, with delivery included across South Africa.`, `Shop: ${p.url}`, hashtags(p, 3)].filter(Boolean).join("\n\n"), LIMITS.linkedin);
  }
}
