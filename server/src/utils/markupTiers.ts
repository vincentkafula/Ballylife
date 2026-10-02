/**
 * Markup on landed cost (goods + shipping, in rand). Currently a flat 25%
 * ("*:25" -- a single tier covering every price). This can still be set
 * as a genuine sliding scale instead: HOUSE_MARKUP_TIERS=
 * "150:40,400:30,1000:25,*:20" means landed cost up to R150 -> +40%, up
 * to R400 -> +30%, up to R1000 -> +25%, above -> +20%. One place
 * (this env var) controls it either way -- never hardcoded per call site.
 */
export interface MarkupTier { upToZar: number; pct: number }

export const DEFAULT_MARKUP_TIERS = "*:25";

export function parseMarkupTiers(spec: string | undefined): MarkupTier[] {
  const tiers = String(spec ?? "").split(",").map(part => {
    const [limit, pct] = part.split(":").map(s => s.trim());
    const p = Number(pct);
    const upTo = limit === "*" ? Infinity : Number(limit);
    return Number.isFinite(p) && p >= 0 && p <= 500 && (upTo === Infinity || (Number.isFinite(upTo) && upTo > 0)) ? { upToZar: upTo, pct: p } : null;
  }).filter((t): t is MarkupTier => t !== null).sort((a, b) => a.upToZar - b.upToZar);
  if (!tiers.length) return parseMarkupTiers(DEFAULT_MARKUP_TIERS);
  if (tiers[tiers.length - 1].upToZar !== Infinity) tiers.push({ upToZar: Infinity, pct: tiers[tiers.length - 1].pct });
  return tiers;
}

let cached: { spec: string; tiers: MarkupTier[] } | null = null;
export function markupTiers(): MarkupTier[] {
  const spec = process.env.HOUSE_MARKUP_TIERS?.trim() || DEFAULT_MARKUP_TIERS;
  if (cached?.spec !== spec) cached = { spec, tiers: parseMarkupTiers(spec) };
  return cached.tiers;
}

export function markupPctFor(landedZar: number, tiers = markupTiers()): number {
  return (tiers.find(t => landedZar <= t.upToZar) ?? tiers[tiers.length - 1]).pct;
}

/**
 * Landed cost plus its tier's markup, rounded up to the next rand. Never
 * lower than the top of the tier below, so a slightly costlier item can't
 * end up cheaper than one just under the boundary (R150 +40% = R210 is the
 * floor for anything that lands above R150).
 */
export function priceWithMarkup(landedZar: number, tiers = markupTiers()): number {
  let price = landedZar * (1 + markupPctFor(landedZar, tiers) / 100);
  for (const t of tiers) if (t.upToZar < landedZar) price = Math.max(price, t.upToZar * (1 + t.pct / 100));
  return Math.ceil(price - 1e-9);
}
