import { createHash } from "crypto";

/**
 * CJ variant ids are stored on the catalog item (external_variants) but
 * never exposed: the customer-facing variant on a seller listing uses this
 * opaque id instead, and fulfilment maps it back by hashing each stored
 * vid. Deterministic, so re-syncs and re-imports produce the same ids.
 */
export function variantIdForVid(vid: string): string {
  return "v_" + createHash("sha256").update(vid).digest("hex").slice(0, 16);
}

export interface ExternalVariant {
  vid: string;
  key: string;       // e.g. "Black-XL", already scrubbed of supplier branding
  priceUsd: number;
  image?: string;
}

export function parseExternalVariants(value: unknown): ExternalVariant[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is ExternalVariant => Boolean(v) && typeof v.vid === "string" && v.vid.length > 0);
}

/**
 * The CJ vid for one order line. A single-variant product needs no choice;
 * a multi-variant one must carry the variant the customer picked.
 */
export function resolveVid(variants: ExternalVariant[], chosenVariantId: string | null | undefined): string | null {
  if (variants.length === 1) return variants[0].vid;
  if (!chosenVariantId) return null;
  return variants.find(v => variantIdForVid(v.vid) === chosenVariantId)?.vid ?? null;
}
