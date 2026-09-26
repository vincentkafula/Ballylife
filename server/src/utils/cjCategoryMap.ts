/**
 * Maps CJ's category names onto the storefront's categories.
 *
 * Rules are tried against the MOST specific name first (the leaf, e.g.
 * "Phone Cases"), then its parent ("Phones & Accessories"), then the top
 * level. That matters: CJ's top levels are broad ("Home, Garden &
 * Furniture"), so matching the whole path at once would send bedding to
 * Garden. Within one name, the first matching rule wins, so narrower
 * rules sit above broader ones (phone cases before phones, toys before
 * gaming, beauty before home appliances so hair dryers land in beauty).
 *
 * Each rule names its fine category and the broad one it rolls up to, so a
 * database that lacks the fine category still files the product sensibly.
 */

type Rule = [fine: string, broad: string, re: RegExp];

const RULES: Rule[] = [
  ["cat-01", "cat-01", /\bsmart ?(watch|band)e?s?\b|fitness trackers?|wearable/i],
  ["cat-csv-toys", "cat-03", /\btoys?\b|puzzles?|\bdolls?\b|board games?|building blocks?|stuffed|plush|\brc\b|remote control (car|toy|drone)|educational toys?|kids'? games/i],
  ["cat-csv-mobile-acc", "cat-01", /phones? (cases?|covers?|holders?|stands?|straps?|lens(es)?|accessor)|phones? (&|and) accessor|mobile (phone )?accessor|screen protectors?|power ?banks?|\bchargers?\b|charging|data cables?|selfie|phone bags?/i],
  ["cat-csv-smartphones", "cat-01", /\b(mobile|cell) ?phones?\b|\bsmart ?phones?\b/i],
  ["cat-csv-audio", "cat-01", /ear ?phones?|head ?phones?|ear ?buds?|headsets?|speakers?|\baudio\b|microphones?|\bmp3\b|amplifiers?|hi-?fi/i],
  ["cat-csv-smart-home", "cat-01", /smart home|security|surveillance|\bcctv\b|alarms?|door ?bells?|smart (plugs?|switch|lights?|bulbs?|locks?)|ip cameras?|baby monitors?/i],
  ["cat-csv-cameras", "cat-01", /cameras?|camcorders?|photograph|tripods?|\bdrones?\b|gimbals?|camera lens/i],
  ["cat-csv-gaming", "cat-01", /\bgam(e|es|ing)\b|consoles?|joysticks?|game ?pads?|game controllers?|\bvr\b/i],
  ["cat-csv-computer-acc", "cat-01", /computer (accessor|peripheral|components?|cables?)|keyboards?|\bmouse\b|\bmice\b|usb hubs?|webcams?|laptop (bags?|stands?|accessor|sleeves?)|memory cards?|flash drives?|hard (drives?|disks?)|\bssd\b|monitors?|printers?|mouse ?pads?/i],
  ["cat-csv-laptops", "cat-01", /laptops?|desktops?|\btablets?\b|mini ?pc|\bcomputers?\b/i],
  ["cat-csv-networking", "cat-01", /network|routers?|wi-?fi|modems?|ethernet|signal boosters?/i],
  ["cat-csv-tv", "cat-01", /\btvs?\b|television|projectors?|tv box|home theat|streaming|remote controls?|media players?/i],
  ["cat-csv-solar", "cat-01", /solar/i],
  ["cat-csv-batteries", "cat-01", /batter(y|ies)|power stations?/i],
  ["cat-csv-beauty", "cat-04", /beauty|make ?up|cosmetics?|skin ?care|\bhair\b|wigs?|\bnails?\b|nail art|lip(stick| gloss| balm)|eye ?lash|eyebrow|perfumes?|fragrances?|shav(er|ing)|razors?|face masks?|manicure|pedicure|tattoo|personal care|bath (&|and) body|hair dryers?|straighteners?|curl(ing|ers?)/i],
  ["cat-csv-health", "cat-04", /health|medical|massag|wellness|therapy|posture|orthopedic|braces?\b|thermometers?|blood pressure|oral (care|hygiene)|tooth|dental|hearing aids?/i],
  ["cat-csv-kitchen", "cat-03", /kitchen|cookware|bakeware|dining|tableware|drinkware|utensils?|blenders?|juicers?|coffee|air fryers?|toasters?|kettles?|\bmixers?\b|cookers?|\bovens?\b|knives|cutting boards?|lunch box|water bottles?|cups?\b|mugs?\b|bar tools?/i],
  ["cat-csv-home-appliances", "cat-03", /home appliances?|household appliances?|vacuum|air purifiers?|humidifiers?|dehumidifiers?|\bfans?\b|heaters?|\birons?\b|washing|sewing machines?|air condition/i],
  ["cat-csv-cleaning", "cat-03", /clean|laundry|\bmops?\b|brooms?|trash|garbage|dust|household (supplies|merchandise)|storage (bags?|boxes?)|organi[sz]ers?/i],
  ["cat-csv-automotive", "cat-08", /automobiles?|motorcycles?|motorbikes?|\bcars?\b|vehicles?|\bauto\b|trucks?|car (accessor|electronics|parts|care|interior|exterior|styling|seats?|wash)/i],
  ["cat-csv-pets", "cat-03", /\bpets?\b|\bdogs?\b|\bcats?\b(?! ?eye)|puppy|kitten|aquarium|\bbirds?\b|fish tanks?|leash|collars? (for|&)/i],
  ["cat-csv-baby", "cat-03", /\bbaby\b|babies|maternity|infants?|toddlers?|nursing|strollers?|diapers?|feeding bottles?|\bkids?\b|children/i],
  ["cat-csv-jewellery", "cat-02", /jewel|necklaces?|\brings?\b|earrings?|bracelets?|anklets?|brooch|pendants?|\bwatch(es)?\b|chains?\b/i],
  ["cat-csv-shoes", "cat-02", /shoes?|sneakers?|\bboots?\b|sandals?|slippers?|\bheels?\b|footwear|loafers?|flip.?flops?|insoles?/i],
  ["cat-csv-travel", "cat-02", /travel|luggage|suitcases?|passport|neck pillows?/i],
  ["cat-csv-garden", "cat-03", /garden|lawn|\bplants?\b|seeds?|watering|flower pots?|planters?|patio|\bbbq\b|barbecue|grill|pool\b/i],
  ["cat-csv-sports", "cat-05", /sports?|fitness|\bgym\b|yoga|outdoors?|camping|hiking|cycling|bicycles?|\bbikes?\b|fishing|swim|running|\bballs?\b|golf|climbing|hunting|skat|\bski(ing)?\b|surf|boxing|exercise|sleeping bags?|\btents?\b|scooters?/i],
  ["cat-csv-bags", "cat-02", /\bbags?\b|handbags?|backpacks?|wallets?|purses?|\btotes?\b|clutch|crossbody|shoulder bags?/i],
  ["cat-csv-school", "cat-06", /school|students?|art supplies|painting|drawing|\bcraft|sketch/i],
  ["cat-csv-office", "cat-06", /office|stationery|\bpens?\b|pencils?|paper|notebooks?|folders?|desk accessor|calculators?|labels?|staplers?|\btape\b/i],
  ["cat-csv-diy", "cat-03", /\btools?\b|hardware|drills?|screwdrivers?|wrench|home improvement|measur|welding|\bglue\b|fasteners?/i],
  ["cat-csv-electrical", "cat-03", /electrical|plumbing|\bwires?\b|sockets?|switches|faucets?|\bpipes?\b|bathroom fixtures?/i],
  ["cat-csv-safety", "cat-03", /safety|protective|first aid|fire (extinguisher|alarm)|reflective|work gloves/i],
  ["cat-csv-decor", "cat-03", /\blamps?\b|\blights?\b|lighting|led strips?|decor|wall (art|stickers?)|vases?|candles?|clocks?|curtains?|\brugs?\b|carpets?|cushions?|pillows?|bedding|blankets?|towels?|photo frames?|artificial (flowers?|plants?)|home textiles?|festive|party|christmas|halloween|wedding|mirrors?/i],
  ["cat-csv-furniture", "cat-03", /furniture|chairs?|\btables?\b|sofas?|shel(f|ves)|cabinets?|\bdesks?\b|\bbeds?\b|mattress|wardrobes?|stools?/i],
  ["cat-csv-fashion", "cat-02", /cloth|apparel|dress(es)?|shirts?|\btees?\b|blouses?|\btops?\b|jackets?|coats?|hoodies?|sweat|pants|trousers|jeans|shorts|skirts?|\bsuits?\b|underwear|lingerie|\bbras?\b|socks?|pajamas|sleepwear|swimwear|bikinis?|leggings|costumes?|uniforms?|\bhats?\b|\bcaps?\b|scarves|scarf|gloves?|belts?|sunglasses|eyewear|hair accessor|\bmen'?s\b|\bwomen'?s\b|fashion/i],
  ["cat-csv-grocery", "cat-03", /\bfood\b|snacks?|grocery|\btea\b/i],
];

// Broad fallbacks, only tried once no specific rule matched ANY level --
// otherwise a vague middle level ("Interior Accessories") would win over a
// clear top level ("Automobiles & Motorcycles").
const FALLBACK_RULES: Rule[] = [
  ["cat-01", "cat-01", /electronic|gadgets?|\busb\b|\bled\b|smart|digital|bluetooth|wireless/i],
  ["cat-02", "cat-02", /accessor/i],
  ["cat-03", "cat-03", /\bhome\b|household|living/i],
];

/** Never auto-listed: not something to put in front of a general audience or advertise. */
const EXCLUDED = /\badult\b|sexual|erotic|\bsex\b|vape|vaping|e-?cig|cigarettes?|tobacco|hookah|shisha|weapons?|firearms?|ammunition|stun guns?|pepper spray/i;

export function isExcludedFromStore(...texts: (string | undefined | null)[]): boolean {
  return texts.some(t => Boolean(t) && EXCLUDED.test(String(t)));
}

export interface CategoryMatch { fine: string; broad: string }

/** `levels` from most to least specific: leaf, parent, top-level (and optionally a product name last). */
export function matchCjCategory(...levels: (string | undefined | null)[]): CategoryMatch | null {
  for (const rules of [RULES, FALLBACK_RULES]) {
    for (const level of levels) {
      if (!level) continue;
      const rule = rules.find(([, , re]) => re.test(level));
      if (rule) return { fine: rule[0], broad: rule[1] };
    }
  }
  return null;
}

/** Picks the most specific of our categories that actually exists in this database. */
export function resolveCategory(match: CategoryMatch | null, known: Set<string>, fallback: string): string | null {
  if (match && known.has(match.fine)) return match.fine;
  if (match && known.has(match.broad)) return match.broad;
  return known.has(fallback) ? fallback : null;
}
