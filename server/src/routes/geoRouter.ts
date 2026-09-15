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
  { countryCode: "ZM", country: "Zambia", code: "ZMW", symbol: "K", name: "Zambian Kwacha" },
  { countryCode: "ZA", country: "South Africa", code: "ZAR", symbol: "R", name: "South African Rand" },
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
