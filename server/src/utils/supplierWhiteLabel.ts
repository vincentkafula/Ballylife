/**
 * White-labelling helpers for supplier-sourced (CJdropshipping, including
 * 1688 items CJ sources on our behalf) catalog data.
 *
 * Product photos are stored in the database as the supplier's own CDN
 * URLs -- that's the only real photography these products have -- but a
 * raw cf.cjdropshipping.com / alicdn.com URL in a storefront <img> tag
 * tells anyone who opens devtools exactly where the product comes from.
 * So every API response rewrites those URLs to our own
 * /api/marketplace/media/... proxy path (served by mediaRouter.ts), and
 * the raw URL never leaves the server.
 *
 * Non-supplier values pass through untouched: seller-uploaded photo URLs,
 * and the legacy "#rrggbb" colour pairs the seeded catalog still uses as
 * its gradient placeholder.
 */

// Hosts CJ serves product photography from. alicdn.com / 1688.com cover
// 1688-sourced items whose photos CJ passes through unchanged. This list
// is also the proxy's SSRF allowlist -- mediaRouter will only ever fetch
// from these hosts, never an arbitrary URL a seller typed in.
const SUPPLIER_IMAGE_HOSTS = [
  /(^|\.)cjdropshipping\.com$/i,
  /(^|\.)aliyuncs\.com$/i,
  /(^|\.)alicdn\.com$/i,
  /(^|\.)1688\.com$/i,
];

export const MAX_PRODUCT_IMAGES = 12;

export function isPhotoUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

export function isSupplierImageUrl(value: unknown): value is string {
  if (!isPhotoUrl(value)) return false;
  try {
    const { protocol, hostname } = new URL(value);
    return (protocol === "https:" || protocol === "http:") && SUPPLIER_IMAGE_HOSTS.some(re => re.test(hostname));
  } catch {
    return false;
  }
}

/** kind "p" = mkt_products row, "c" = mkt_supplier_products (catalog) row. */
export function publicImages(kind: "p" | "c", id: string, images: unknown): unknown[] {
  if (!Array.isArray(images)) return [];
  return images.map((img, i) => (isSupplierImageUrl(img) ? `/api/marketplace/media/${kind}/${id}/${i}` : img));
}

/** First real photo for a row (already rewritten by publicImages), if any. */
export function firstPhoto(images: unknown[]): string | null {
  const hit = images.find(img => typeof img === "string" && (img.startsWith("/api/marketplace/media/") || isPhotoUrl(img)));
  return (hit as string | undefined) ?? null;
}

// Supplier/marketplace names that must never reach a seller or customer.
// Word-bounded so e.g. "CJ" doesn't eat the middle of an unrelated word.
const BRANDING_PATTERNS: RegExp[] = [
  /\bcj\s*-?\s*drop\s*-?\s*shipping(\.com)?\b/gi,
  /\bcj\s*(packaging|packing|logo|brand(ed)?|warehouse|product|sku)\b/gi,
  /\bcj\b/gi,
  /\b1688(\.com)?\b/gi,
  /\b(alibaba|aliexpress|taobao|tmall)(\.com)?\b/gi,
  /(阿里巴巴|淘宝|天猫)/g,
];

export function mentionsSupplier(text: string): boolean {
  return BRANDING_PATTERNS.some(re => { re.lastIndex = 0; return re.test(text); });
}

/** For short strings (product names): cut the brand tokens out, keep the rest. */
export function scrubSupplierBranding(text: string | null | undefined): string {
  if (!text) return "";
  let out = text;
  for (const re of BRANDING_PATTERNS) out = out.replace(re, "");
  return out
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^[\s\-–—|,:]+|[\s\-–—|,:]+$/g, "")
    .trim();
}

/**
 * CJ descriptions are HTML, frequently with the real detail photography
 * embedded as <img> tags. Returns plain text (the storefront renders
 * descriptions as text) plus the embedded image URLs so they can join the
 * product's gallery instead of being lost.
 */
export function splitSupplierDescription(html: string | null | undefined): { text: string; imageUrls: string[] } {
  if (!html) return { text: "", imageUrls: [] };
  const imageUrls = [...html.matchAll(/<img[^>]+src\s*=\s*["']([^"']+)["']/gi)]
    .map(m => (m[1].startsWith("//") ? `https:${m[1]}` : m[1]))
    .filter(isPhotoUrl);
  const text = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    // Cutting a brand token out of a sentence leaves nonsense ("Ships in
    // from."), so in descriptions any sentence that mentions a supplier is
    // dropped whole.
    .split("\n")
    .map(line => line.split(/(?<=[.!?])\s+/).filter(sentence => !mentionsSupplier(sentence)).join(" ").trim())
    .filter(Boolean)
    .join("\n");
  return { text, imageUrls };
}

/** CJ returns image lists as a real array, a JSON-encoded string, or a comma list depending on endpoint. */
export function parseSupplierImageList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter(isPhotoUrl);
  if (typeof value !== "string" || !value.trim()) return [];
  const s = value.trim();
  if (s.startsWith("[")) {
    try { return parseSupplierImageList(JSON.parse(s)); } catch { /* fall through to comma split */ }
  }
  return s.split(",").map(x => x.trim()).filter(isPhotoUrl);
}

export function dedupeImages(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const key = u.split("?")[0];
    if (!seen.has(key)) { seen.add(key); out.push(u); }
    if (out.length >= MAX_PRODUCT_IMAGES) break;
  }
  return out;
}
