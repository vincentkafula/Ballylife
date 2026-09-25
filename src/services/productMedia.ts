import { API_BASE } from "./config";

/**
 * A product's `images` array holds either real photos -- supplier photos
 * arrive as our own /api/marketplace/media/... proxy paths, seller uploads
 * as absolute URLs -- or, for the older seeded catalog, a pair of "#rrggbb"
 * colours used as a gradient placeholder behind the emoji. These helpers
 * tell the two apart so every product surface shows the real photo when
 * there is one and falls back to the placeholder only when there isn't.
 */

export function productPhotos(images: unknown): string[] {
  if (!Array.isArray(images)) return [];
  return images.flatMap((img): string[] => {
    if (typeof img !== "string") return [];
    if (img.startsWith("/api/")) return [`${API_BASE}${img}`];
    if (/^https?:\/\//i.test(img)) return [img];
    return [];
  });
}

export function productColors(images: unknown, fallbackA: string, fallbackB: string): [string, string] {
  const colors = Array.isArray(images) ? images.filter((i): i is string => typeof i === "string" && i.startsWith("#")) : [];
  return [colors[0] ?? fallbackA, colors[1] ?? fallbackB];
}
