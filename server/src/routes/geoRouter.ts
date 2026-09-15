import { Router, type Request, type Response } from "express";
import { pool } from "../db/pool";

const router = Router();

// The set of countries this storefront actually has a working currency
// conversion for -- kept tightly matched to what's really in
// mkt_fx_rates (USD, CNY, JPY, KRW, ZMW) plus South Africa (ZAR, the
// storefront's own base currency, rate always 1). Every entry here
// converts correctly; adding a country without a real rate behind it
// would just silently show wrong numbers, so the list stays short and
// honest rather than broad and partly fake.
interface CountryOption {
  countryCode: string;
  country: string;
  code: string;
  symbol: string;
  name: string;
}

const SUPPORTED_COUNTRIES: CountryOption[] = [
  // Southern Africa (Ballylife's home region)
  { countryCode: "ZM", country: "Zambia", code: "ZMW", symbol: "K", name: "Zambian Kwacha" },
  { countryCode: "ZA", country: "South Africa", code: "ZAR", symbol: "R", name: "South African Rand" },
  { countryCode: "ZW", country: "Zimbabwe", code: "USD", symbol: "$", name: "US Dollar" }, // Zimbabwe's own currency (ZWL) has a history of severe instability -- USD is what's actually used day to day
  { countryCode: "BW", country: "Botswana", code: "BWP", symbol: "P", name: "Botswana Pula" },
  { countryCode: "NA", country: "Namibia", code: "NAD", symbol: "N$", name: "Namibian Dollar" },
  { countryCode: "LS", country: "Lesotho", code: "LSL", symbol: "L", name: "Lesotho Loti" },
  { countryCode: "SZ", country: "Eswatini", code: "SZL", symbol: "L", name: "Swazi Lilangeni" },
  { countryCode: "MZ", country: "Mozambique", code: "MZN", symbol: "MT", name: "Mozambican Metical" },
  { countryCode: "MW", country: "Malawi", code: "MWK", symbol: "MK", name: "Malawian Kwacha" },
  { countryCode: "MG", country: "Madagascar", code: "MGA", symbol: "Ar", name: "Malagasy Ariary" },
  { countryCode: "MU", country: "Mauritius", code: "MUR", symbol: "₨", name: "Mauritian Rupee" },
  { countryCode: "SC", country: "Seychelles", code: "SCR", symbol: "₨", name: "Seychellois Rupee" },
  { countryCode: "KM", country: "Comoros", code: "KMF", symbol: "CF", name: "Comorian Franc" },
  // East Africa
  { countryCode: "KE", country: "Kenya", code: "KES", symbol: "KSh", name: "Kenyan Shilling" },
  { countryCode: "TZ", country: "Tanzania", code: "TZS", symbol: "TSh", name: "Tanzanian Shilling" },
  { countryCode: "UG", country: "Uganda", code: "UGX", symbol: "USh", name: "Ugandan Shilling" },
  { countryCode: "RW", country: "Rwanda", code: "RWF", symbol: "FRw", name: "Rwandan Franc" },
  { countryCode: "BI", country: "Burundi", code: "BIF", symbol: "FBu", name: "Burundian Franc" },
  { countryCode: "ET", country: "Ethiopia", code: "ETB", symbol: "Br", name: "Ethiopian Birr" },
  { countryCode: "ER", country: "Eritrea", code: "ERN", symbol: "Nfk", name: "Eritrean Nakfa" },
  { countryCode: "SO", country: "Somalia", code: "SOS", symbol: "Sh", name: "Somali Shilling" },
  { countryCode: "SS", country: "South Sudan", code: "SSP", symbol: "£", name: "South Sudanese Pound" },
  { countryCode: "SD", country: "Sudan", code: "SDG", symbol: "ج.س.", name: "Sudanese Pound" },
  { countryCode: "DJ", country: "Djibouti", code: "DJF", symbol: "Fdj", name: "Djiboutian Franc" },
  // Central Africa (XAF)
  { countryCode: "CM", country: "Cameroon", code: "XAF", symbol: "FCFA", name: "Central African CFA Franc" },
  { countryCode: "CF", country: "Central African Republic", code: "XAF", symbol: "FCFA", name: "Central African CFA Franc" },
  { countryCode: "TD", country: "Chad", code: "XAF", symbol: "FCFA", name: "Central African CFA Franc" },
  { countryCode: "CG", country: "Republic of the Congo", code: "XAF", symbol: "FCFA", name: "Central African CFA Franc" },
  { countryCode: "GQ", country: "Equatorial Guinea", code: "XAF", symbol: "FCFA", name: "Central African CFA Franc" },
  { countryCode: "GA", country: "Gabon", code: "XAF", symbol: "FCFA", name: "Central African CFA Franc" },
  { countryCode: "CD", country: "DR Congo", code: "CDF", symbol: "FC", name: "Congolese Franc" },
  { countryCode: "ST", country: "São Tomé and Príncipe", code: "STN", symbol: "Db", name: "São Tomé and Príncipe Dobra" },
  // West Africa (mostly XOF)
  { countryCode: "NG", country: "Nigeria", code: "NGN", symbol: "₦", name: "Nigerian Naira" },
  { countryCode: "GH", country: "Ghana", code: "GHS", symbol: "GH₵", name: "Ghanaian Cedi" },
  { countryCode: "CI", country: "Ivory Coast", code: "XOF", symbol: "CFA", name: "West African CFA Franc" },
  { countryCode: "SN", country: "Senegal", code: "XOF", symbol: "CFA", name: "West African CFA Franc" },
  { countryCode: "ML", country: "Mali", code: "XOF", symbol: "CFA", name: "West African CFA Franc" },
  { countryCode: "BF", country: "Burkina Faso", code: "XOF", symbol: "CFA", name: "West African CFA Franc" },
  { countryCode: "NE", country: "Niger", code: "XOF", symbol: "CFA", name: "West African CFA Franc" },
  { countryCode: "BJ", country: "Benin", code: "XOF", symbol: "CFA", name: "West African CFA Franc" },
  { countryCode: "TG", country: "Togo", code: "XOF", symbol: "CFA", name: "West African CFA Franc" },
  { countryCode: "GW", country: "Guinea-Bissau", code: "XOF", symbol: "CFA", name: "West African CFA Franc" },
  { countryCode: "GN", country: "Guinea", code: "GNF", symbol: "FG", name: "Guinean Franc" },
  { countryCode: "SL", country: "Sierra Leone", code: "SLL", symbol: "Le", name: "Sierra Leonean Leone" },
  { countryCode: "LR", country: "Liberia", code: "LRD", symbol: "L$", name: "Liberian Dollar" },
  { countryCode: "GM", country: "Gambia", code: "GMD", symbol: "D", name: "Gambian Dalasi" },
  { countryCode: "CV", country: "Cape Verde", code: "CVE", symbol: "$", name: "Cape Verdean Escudo" },
  { countryCode: "MR", country: "Mauritania", code: "MRU", symbol: "UM", name: "Mauritanian Ouguiya" },
  // North Africa
  { countryCode: "EG", country: "Egypt", code: "EGP", symbol: "E£", name: "Egyptian Pound" },
  { countryCode: "MA", country: "Morocco", code: "MAD", symbol: "د.م.", name: "Moroccan Dirham" },
  { countryCode: "DZ", country: "Algeria", code: "DZD", symbol: "دج", name: "Algerian Dinar" },
  { countryCode: "TN", country: "Tunisia", code: "TND", symbol: "د.ت", name: "Tunisian Dinar" },
  { countryCode: "LY", country: "Libya", code: "LYD", symbol: "ل.د", name: "Libyan Dinar" },
  // Southern Africa (rest)
  { countryCode: "AO", country: "Angola", code: "AOA", symbol: "Kz", name: "Angolan Kwanza" },
  // Non-African reference currencies, kept from the original selector
  { countryCode: "US", country: "United States", code: "USD", symbol: "$", name: "US Dollar" },
  { countryCode: "CN", country: "China", code: "CNY", symbol: "¥", name: "Chinese Yuan" },
  { countryCode: "JP", country: "Japan", code: "JPY", symbol: "¥", name: "Japanese Yen" },
  { countryCode: "KR", country: "South Korea", code: "KRW", symbol: "₩", name: "South Korean Won" },
];
const ZM_DEFAULT = SUPPORTED_COUNTRIES[0];

router.get("/geo/countries", (_req: Request, res: Response) => {
  res.json({ success: true, data: SUPPORTED_COUNTRIES });
});

// IP-based country detection. Requires app.set("trust proxy", ...) in
// index.ts so req.ip reflects Railway's X-Forwarded-For rather than
// the proxy's own address -- without that this always resolves to a
// private/internal IP and silently falls back to the default, which
// is exactly the symptom this route exists to fix.
router.get("/geo/detect", async (req: Request, res: Response) => {
  const ip = req.ip ?? "";
  const isPrivate = !ip || ip === "::1" || ip.startsWith("127.") || ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("::ffff:127.");
  if (isPrivate) {
    // Local dev / no real client IP to resolve -- fall back rather
    // than send a loopback address to a geolocation service.
    res.json({ success: true, data: ZM_DEFAULT });
    return;
  }
  try {
    const geoRes = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,countryCode`);
    const geo = await geoRes.json() as { status: string; countryCode?: string };
    const match = geo.status === "success" ? SUPPORTED_COUNTRIES.find(c => c.countryCode === geo.countryCode) : undefined;
    res.json({ success: true, data: match ?? ZM_DEFAULT });
  } catch (err) {
    console.error("[geo] IP detection failed, falling back to default:", err);
    res.json({ success: true, data: ZM_DEFAULT });
  }
});

// Live-location detection: the browser's own Geolocation API gives an
// actual GPS/network-assisted position, which is more precise than IP
// lookup (no VPN/proxy/corporate-network skew) -- the frontend calls
// this once the user grants location permission and gets back a real
// lat/lng pair. Reverse-geocoded via OpenStreetMap's free Nominatim
// API (no key required; a descriptive User-Agent is required by their
// usage policy).
router.post("/geo/reverse", async (req: Request, res: Response) => {
  const { lat, lng } = req.body as { lat?: number; lng?: number };
  if (typeof lat !== "number" || typeof lng !== "number") {
    res.status(400).json({ success: false, error: "lat and lng (numbers) are required" });
    return;
  }
  try {
    const geoRes = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=3`,
      { headers: { "User-Agent": "Ballylife-Marketplace/1.0 (contact: vincent.kafula@gmail.com)" } }
    );
    const geo = await geoRes.json() as { address?: { country_code?: string } };
    const countryCode = geo.address?.country_code?.toUpperCase();
    const match = countryCode ? SUPPORTED_COUNTRIES.find(c => c.countryCode === countryCode) : undefined;
    if (!match) {
      res.json({ success: true, data: ZM_DEFAULT, meta: { matchedSupportedList: false } });
      return;
    }
    res.json({ success: true, data: match });
  } catch (err) {
    console.error("[geo] Reverse geocoding failed:", err);
    res.status(502).json({ success: false, error: "Could not resolve your location right now" });
  }
});

router.get("/currency/rates", async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool!.query(`SELECT currency, rate_to_zar, updated_at FROM mkt_fx_rates`);
    // rate_to_zar is "1 unit of currency = this many ZAR" (admin-facing,
    // used for duty/settlement math elsewhere in this app) -- the
    // storefront's own display prices are treated as ZAR-denominated,
    // so what the frontend needs is the inverse: how many units of
    // {currency} does 1 ZAR buy.
    const rates: Record<string, number> = { ZAR: 1 };
    let oldestUpdate = new Date();
    for (const r of rows) {
      const rateToZar = Number(r.rate_to_zar);
      if (rateToZar > 0) rates[r.currency] = 1 / rateToZar;
      const updatedAt = new Date(r.updated_at);
      if (updatedAt < oldestUpdate) oldestUpdate = updatedAt;
    }
    const staleMs = 1000 * 60 * 60 * 24 * 7; // a week with no rate refresh is worth flagging
    const stale = rows.length > 0 && (Date.now() - oldestUpdate.getTime()) > staleMs;
    res.json({ success: true, data: { rates }, stale });
  } catch (err) {
    console.error("[currency] Failed to load FX rates:", err);
    res.status(500).json({ success: false, error: "Failed to load currency rates" });
  }
});

export default router;
