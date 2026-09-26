import { useState, useEffect, useCallback, useRef, Fragment, lazy, Suspense, type ReactNode, type CSSProperties } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ApiConnectionError } from "../services/marketplaceApi";
import { pathForView, viewForPath, TITLE_FOR_VIEW, setPageMeta, type MarketplaceView } from "../services/routes";
import ballylifeLogo from "../imports/ballylife-logo-compact.png";
import businessBoardroomAd from "../imports/business-boardroom-ad.jpg";
import {
  Search, ShoppingCart, Heart, Star, ChevronRight, ArrowLeft,
  SlidersHorizontal, Grid, List, Plus, Minus, Trash2,
  Package, Truck, CheckCircle, Tag, TrendingUp, BarChart3,
  Settings, Menu, Clock, Shield, Zap, RotateCcw, Loader2,
  Home, Filter, MapPin, ChevronDown, User, LogOut, ShoppingBag,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import {
  mktCategories, mktProducts, mktCart, mktOrders,
  mktWishlist, mktSellers, mktAdmin, mktAddresses, mktAddAddress, mktAuth, setMktToken, type MktAuthUser,
} from "../services/marketplaceApi";
import { productPhotos, productColors } from "../services/productMedia";
import {
  ExecutiveChairIllustration, MeshTaskChairIllustration, ManagerChairIllustration,
  ConferenceChairIllustration, DraftingStoolIllustration, VisitorChairIllustration,
  GamingChairIllustration,
} from "./ChairIllustrations";
import { VEHICLE_ILLUSTRATIONS } from "./VehicleIllustrations";

// Maps a product id to an original illustration component, used in place of
// the plain emoji for listings that have one (currently the 7 generic
// office chair products). Falls back to the emoji for everything else.
const PRODUCT_ILLUSTRATIONS: Record<string, () => ReactNode> = {
  "p-13": ExecutiveChairIllustration,
  "p-14": MeshTaskChairIllustration,
  "p-15": ManagerChairIllustration,
  "p-16": ConferenceChairIllustration,
  "p-17": DraftingStoolIllustration,
  "p-18": VisitorChairIllustration,
  "p-19": GamingChairIllustration,
};

// Vehicles don't have fixed ids the way the 7 seeded chairs do (real
// inventory gets added/removed over time), so their illustration is
// looked up by body type instead of product id — any product whose
// vehicleDetails.bodyType matches gets the right silhouette, present or
// future. Falls back to PRODUCT_ILLUSTRATIONS[p.id], then the emoji.
function getProductIllustration(p: Record<string, unknown>): (() => ReactNode) | undefined {
  if (PRODUCT_ILLUSTRATIONS[p.id as string]) return PRODUCT_ILLUSTRATIONS[p.id as string];
  const vd = p.vehicleDetails as Record<string, unknown> | null | undefined;
  if (vd?.bodyType && VEHICLE_ILLUSTRATIONS[vd.bodyType as string]) return VEHICLE_ILLUSTRATIONS[vd.bodyType as string];
  return undefined;
}

// Real product photo layered over the placeholder artwork. object-contain on
// white, because supplier shots are usually a product on a white backdrop and
// cropping them (object-cover) cuts off the product in portrait cards. If the
// image fails to load, it removes itself and the emoji/gradient shows through.
function ProductPhoto({ src, alt, className = "", eager = false }: { src: string; alt: string; className?: string; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img src={src} alt={alt} loading={eager ? "eager" : "lazy"} decoding="async" onError={() => setFailed(true)}
      className={`absolute inset-0 w-full h-full object-contain bg-white ${className}`} />
  );
}
// Delivery promises. Imported (supplier-fulfilled) items ship straight to the
// customer with delivery included in the price; local items keep the flat
// local fee (free over R500) and the shorter window. Mirrors utils/delivery.ts.
const LOCAL_DELIVERY_WINDOW = "3–5 business days";
const INTL_DELIVERY_WINDOW = "10–20 business days";

function deliveryWindowFor(p: R): string {
  const d = p.deliveryDays as { min?: number; max?: number } | undefined;
  return p.shippingIncluded ? (d?.min && d?.max ? `${d.min}–${d.max} business days` : INTL_DELIVERY_WINDOW) : LOCAL_DELIVERY_WINDOW;
}

/** When prices are displayed in another currency, state the exact rand amount that will be charged. */
function ChargedInZarNote({ zarTotal }: { zarTotal: number }) {
  if (!isShowingConvertedPrices()) return null;
  const rands = `R${Number(zarTotal ?? 0).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    <p className="text-[11px] text-gray-600 leading-snug bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2">
      Converted prices are estimates. You'll be charged <b>{rands}</b> in South African rand; your bank sets the final amount.
    </p>
  );
}

/** What to promise for a whole cart/order, given its items' shippingIncluded flags. */
function cartDeliveryWindow(items: R[]): string {
  const intl = items.some(i => i.shippingIncluded);
  const local = items.some(i => !i.shippingIncluded);
  if (intl && local) return `${LOCAL_DELIVERY_WINDOW} for local items, ${INTL_DELIVERY_WINDOW} for imported items`;
  return intl ? INTL_DELIVERY_WINDOW : LOCAL_DELIVERY_WINDOW;
}
import { MarketplaceAuthModal } from "./MarketplaceAuthModal";
import { DefaultPasswordBanner } from "./DefaultPasswordBanner";
import { MorePlansPage } from "./MembershipPanels";
import { CardPaymentPanel, CardSchemeMarks, EftDetailsTable, SecureCheckoutNote, type PaymentMethodsInfo } from "./PaymentBadges";
import { OrderTracking } from "./OrderTracking";
import { JapanPartBadge, JapanPartDisclosure } from "./JapanParts";
// These five are static content pages (legal/policy text with large
// embedded HTML) reachable only from footer links most shoppers never
// click -- lazy-loaded so their weight sits in its own chunk instead of
// the main bundle everyone downloads just to browse the storefront.
const ContactPage = lazy(() => import("./ContactPage").then(m => ({ default: m.ContactPage })));
const TermsPage = lazy(() => import("./TermsPage").then(m => ({ default: m.TermsPage })));
const HumanRightsPage = lazy(() => import("./HumanRightsPage").then(m => ({ default: m.HumanRightsPage })));
const DisclosurePage = lazy(() => import("./DisclosurePage").then(m => ({ default: m.DisclosurePage })));
const SpeakUpPage = lazy(() => import("./SpeakUpPage").then(m => ({ default: m.SpeakUpPage })));
const AdvertisingPage = lazy(() => import("./AdvertisingPage").then(m => ({ default: m.AdvertisingPage })));
const CreditRewardsPage = lazy(() => import("./CreditRewardsPage").then(m => ({ default: m.CreditRewardsPage })));
const BusinessTermsPage = lazy(() => import("./BusinessTermsPage").then(m => ({ default: m.BusinessTermsPage })));
const PrivacyPolicyPage = lazy(() => import("./PrivacyPolicyPage").then(m => ({ default: m.PrivacyPolicyPage })));
const ReturnsPolicyPage = lazy(() => import("./ReturnsPolicyPage").then(m => ({ default: m.ReturnsPolicyPage })));
const BallylifeMorePage = lazy(() => import("./BallylifeMorePage").then(m => ({ default: m.BallylifeMorePage })));
const AboutUsPage = lazy(() => import("./AboutUsPage").then(m => ({ default: m.AboutUsPage })));
import { CustomerDashboard } from "./CustomerDashboard";
import { SellerDashboard } from "./SellerDashboard";
import { SupplierDashboard } from "./SupplierDashboard";
import { AuthorityDashboard } from "./AuthorityDashboard";
import { ShippingCompanyDashboard } from "./ShippingCompanyDashboard";
import { CreditProviderDashboard } from "./CreditProviderDashboard";
import { ManagerDashboard } from "./ManagerDashboard";
import { Product3DViewer } from "./Product3DViewer";
import { ProductPhotoGallery } from "./ProductPhotoGallery";
import { Footer } from "./Footer";
import { formatZAR, useCurrency, useLiveLocation, setCountryManually, isShowingConvertedPrices } from "../services/currencyStore";

// ─── Types ────────────────────────────────────────────────────────────────────
type View = "morePlans" | "home" | "catalog" | "product" | "cart" | "checkout" | "orders" | "wishlist" | "seller" | "supplier" | "authority" | "shipping" | "credit" | "admin" | "account" | "trackOrder" | "contactPage" | "termsPage" | "humanRightsPage" | "disclosurePage" | "speakUpPage" | "advertisingPage" | "creditRewardsPage" | "businessTermsPage" | "privacyPolicyPage" | "returnsPolicyPage" | "ballylifeMorePage" | "aboutUsPage";
type CheckoutStep = "address" | "shipping" | "payment" | "confirmation";
type R = Record<string, unknown>;

// ─── Recently viewed products (localStorage, no backend needed) ───────────
const RECENT_KEY = "ballylife_recently_viewed";
function getRecentlyViewed(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); } catch { return []; }
}
function addRecentlyViewed(id: string) {
  const list = getRecentlyViewed().filter(x => x !== id);
  list.unshift(id);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 12))); } catch { /* storage unavailable */ }
}
function clearRecentlyViewed() {
  try { localStorage.removeItem(RECENT_KEY); } catch { /* storage unavailable */ }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtZAR = formatZAR; // now converts + formats in the shopper's local currency

// Shared handler for a failed data-load call across every view. An
// ApiConnectionError already carries a genuinely friendly message
// ("we're having trouble connecting..."); anything else surfaces a
// generic one rather than a raw technical error string, since most
// thrown errors here aren't written with an end user as the audience.
function showLoadError(err: unknown) {
  if (err instanceof ApiConnectionError) toast.error(err.message);
  else toast.error("Something went wrong loading this page — please try again.");
}

// True only when the app is running as the installed PWA/TWA (opened
// from a home-screen icon, no browser chrome) -- false in an ordinary
// browser tab, even on the exact same phone at the exact same width.
// display-mode: standalone is what Android's TWA wrapper reports;
// navigator.standalone is Safari's older iOS-only equivalent, kept as
// a fallback since not every engine supports the media query yet.
function useIsStandalone(): boolean {
  const [standalone, setStandalone] = useState(() =>
    typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)").matches || (window.navigator as { standalone?: boolean }).standalone === true)
  );
  useEffect(() => {
    const mq = window.matchMedia("(display-mode: standalone)");
    const onChange = () => setStandalone(mq.matches || (window.navigator as { standalone?: boolean }).standalone === true);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return standalone;
}
const ago = (iso: string) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const STATUS_COLOR: Record<string, string> = {
  delivered: "#10B981", shipped: "#3B82F6", processing: "#F59E0B",
  confirmed: "#34A853", pending: "#9CA3AF", cancelled: "#EF4444",
};

// ─── Auto-slide hook ────────────────────────────────────────────────────────
// Continuously drifts a scroll container to the left (content flows right-to-
// left) so product rows feel alive without requiring the user to drag/swipe.
// Pauses on hover/touch and loops back to the start once it reaches the end.
function useManualSlide<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const scroll = (dir: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };
  return { ref, scrollLeft: () => scroll(-1), scrollRight: () => scroll(1) };
}

function SlideArrows({ onLeft, onRight }: { onLeft: () => void; onRight: () => void }) {
  const btn = "absolute top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-white shadow-md border border-gray-200 flex items-center justify-center text-gray-600 hover:text-white transition-colors";
  return (
    <>
      <button
        onClick={onLeft}
        aria-label="Scroll left"
        className={`${btn} left-1`}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "#B8862E"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "#fff"; }}
      >
        <ChevronRight className="w-4 h-4 rotate-180" />
      </button>
      <button
        onClick={onRight}
        aria-label="Scroll right"
        className={`${btn} right-1`}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "#B8862E"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "#fff"; }}
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </>
  );
}

// ─── Stars ────────────────────────────────────────────────────────────────────
function Stars({ rating, size = 13 }: { rating: number; size?: number }) {
  return (
    <div className="flex items-center gap-px">
      {[1, 2, 3, 4, 5].map(s => (
        <svg key={s} width={size} height={size} viewBox="0 0 24 24"
          fill={s <= Math.round(rating) ? "#FBBF24" : "#E5E7EB"}>
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
    </div>
  );
}

// ─── Product Card ─────────────────────────────────────────────────────────────
// ─── Promo banner (full-width grid interstitial) ───────────────────────────
// Height halved from the original 2164:726 aspect ratio to 2164:363 (width
// unchanged) -- every internal size below was retuned by hand rather than
// left to scale automatically, since CSS resolves margin/padding percentages
// against the container's WIDTH even for vertical spacing, so simply halving
// the box height would have made the old paddings/gaps overflow it.
function PromoBanner({ onShop }: { onShop: () => void }) {
  return (
    <div className="col-span-full relative overflow-hidden rounded-2xl" style={{ background: "linear-gradient(135deg,#0B1A3D 0%,#16336B 55%,#0B1A3D 100%)", aspectRatio: "2164 / 363", containerType: "inline-size" } as CSSProperties}>
      {/* Diagonal motion lines -- suggests speed, fitting the delivery
          theme, and replaces the old repeated ghost "B" pattern which
          read as clutter ("BBBB") rather than texture. */}
      <div className="absolute inset-0 pointer-events-none select-none overflow-hidden opacity-[0.08]">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{
            position: "absolute", top: `${i * 22 - 15}%`, left: `${i * 14}%`,
            width: "70%", height: "3px", background: "linear-gradient(90deg, transparent, #FF7A50, transparent)",
            transform: "rotate(-18deg)",
          }} />
        ))}
      </div>
      {/* Coral accent glow, bottom-left -- distinct from the gold used on
          the other two banners, so all three read as their own thing
          rather than the same palette reskinned. */}
      <div className="absolute -bottom-1/2 -left-[5%] rounded-full pointer-events-none" style={{ width: "24cqw", height: "24cqw", background: "radial-gradient(circle, rgba(255,122,80,0.22), transparent 70%)" }} />

      <div className="relative h-full flex items-center gap-[2.5%] px-[3%]">
        {/* Logo mark */}
        <div className="hidden sm:flex flex-col items-start shrink-0" style={{ maxWidth: "14%" }}>
          <img src={ballylifeLogo} alt="" className="shrink-0" style={{ height: "7cqw", width: "auto", filter: "brightness(0) invert(1)" }} />
        </div>

        {/* Headline */}
        <div className="flex-1 min-w-0 flex items-center gap-[3%]">
          <div className="min-w-0">
            <span className="hidden xl:inline-flex items-center gap-1 rounded-full font-bold mb-[0.6%]" style={{ background: "rgba(255,122,80,0.18)", color: "#FF9D75", fontSize: "clamp(6px,0.85cqw,10px)", padding: "0.6% 2%" }}>
              LIMITED-TIME
            </span>
            <h3 className="font-serif text-white leading-none whitespace-nowrap" style={{ fontWeight: 700, fontSize: "clamp(13px, 3.4cqw, 30px)" }}>
              Live bold. Shop Ballylife in minutes.
            </h3>
            <p className="mt-[0.8%] leading-snug truncate" style={{ color: "rgba(255,255,255,0.78)", fontSize: "clamp(8px, 1.15cqw, 13px)", maxWidth: "44ch" }}>
              Ran out? Ran late? Ran out of excuses. We'll have it at your door before the kettle boils.
            </p>
          </div>
          <button onClick={onShop} className="shrink-0 rounded-full font-black tracking-wide transition-transform hover:scale-[1.03] whitespace-nowrap"
            style={{ background: "linear-gradient(135deg,#FF8C5A,#E8562E)", color: "#0B1A3D", padding: "clamp(4px,1cqw,11px) clamp(12px,2.4cqw,26px)", fontSize: "clamp(8px,1.15cqw,13px)" }}>
            SHOP NOW
          </button>
        </div>

        {/* Compact delivery-time badge, replaces the old full phone mockup
            which no longer fits the halved height without either
            overflowing or shrinking down to illegibility. */}
        <div className="hidden lg:flex items-center gap-[1.2%] shrink-0 rounded-full" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.16)", padding: "1.4% 3%" }}>
          <span className="rounded-full flex items-center justify-center shrink-0" style={{ width: "3.6cqw", height: "3.6cqw", background: "linear-gradient(135deg,#FF8C5A,#E8562E)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#0B1A3D" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: "2cqw", height: "2cqw" }}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></svg>
          </span>
          <div className="leading-none">
            <div className="text-white font-black" style={{ fontSize: "clamp(9px,1.3cqw,14px)" }}>Door-to-door</div>
            <div style={{ color: "rgba(255,255,255,0.6)", fontSize: "clamp(6px,0.85cqw,9px)" }}>delivery, tracked</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProductCard({ p, onView, onCart, wishlistIds, onWishlist }: {
  p: R; onView: () => void; onCart: () => void;
  wishlistIds: Set<string>; onWishlist: () => void;
}) {
  const inWishlist = wishlistIds.has(p.id as string);
  const discount = p.compareAtPrice
    ? Math.round((1 - Number(p.price) / Number(p.compareAtPrice)) * 100)
    : 0;
  const imgs = p.images as string[];

  return (
    <div className="bg-white rounded-xl overflow-hidden border border-gray-200 hover:shadow-xl hover:border-[#D4A54A]/50 transition-all duration-200 group flex flex-col h-full" style={{ boxShadow: "0 1px 3px rgba(20,17,13,0.06)" }}>
      {/* Image — portrait, not square, on a neutral mat like real product photography would sit on */}
      <div className="relative cursor-pointer bg-[#FAFAF9]" style={{ aspectRatio: "3 / 4" }} onClick={onView}>
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden transition-transform duration-300 group-hover:scale-105"
          style={{ background: `linear-gradient(160deg,${productColors(imgs, "#F3F4F6", "#E5E7EB").join(",")})` }}>
          {/* Soft circular spotlight behind the product -- reads as a
              studio backdrop rather than a flat color fill, and gives
              the icon somewhere to visually "sit" rather than floating
              on a bare gradient. */}
          <div className="absolute rounded-full" style={{ width: "78%", aspectRatio: "1", background: "radial-gradient(circle, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.18) 55%, transparent 75%)" }} />
          <div className="relative text-7xl p-5" style={{ filter: "drop-shadow(0 14px 16px rgba(0,0,0,0.18))" }}>
            {getProductIllustration(p)
              ? <div className="w-28 h-28">{getProductIllustration(p)!()}</div>
              : (p.emoji as string)}
          </div>
          {productPhotos(imgs)[0] && <ProductPhoto src={productPhotos(imgs)[0]} alt={p.name as string} className="p-2" />}
        </div>
        {p.isFlashDeal && (
          <div className="absolute top-2 left-2 bg-red-500 text-white text-[9px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
            <Zap className="w-2.5 h-2.5" />FLASH
          </div>
        )}
        {discount > 0 && !p.isFlashDeal && (
          <div className="absolute top-2 left-2 bg-green-500 text-white text-[9px] font-bold px-2 py-0.5 rounded-full">
            -{discount}%
          </div>
        )}
        {p.japanPart && <JapanPartBadge className="absolute bottom-2 left-2" />}
        <button onClick={e => { e.stopPropagation(); onWishlist(); }}
          className="absolute top-2 right-2 w-8 h-8 bg-white rounded-full shadow flex items-center justify-center hover:scale-110 transition-transform">
          <Heart className={`w-4 h-4 ${inWishlist ? "fill-red-500 text-red-500" : "text-gray-300"}`} />
        </button>
      </div>

      <div className="p-3 cursor-pointer flex-1 flex flex-col" onClick={onView}>
        <p className="text-[10px] text-gray-500 mb-0.5">{p.brand as string}</p>
        <p className="text-sm font-semibold text-gray-900 leading-tight line-clamp-2 mb-1.5">{p.name as string}</p>
        <div className="flex items-center gap-1 mb-2">
          <Stars rating={Number(p.avgRating)} size={11} />
          <span className="text-[10px] text-gray-500">({Number(p.reviewCount).toLocaleString()})</span>
        </div>
        <div className="mt-auto">
          <div className="flex items-center gap-2">
            <span className="text-base font-black text-gray-900">{fmtZAR(Number(p.price))}</span>
            {p.compareAtPrice && (
              <span className="text-xs text-gray-500 line-through">{fmtZAR(Number(p.compareAtPrice))}</span>
            )}
          </div>
          {Number(p.stock) > 0 && Number(p.stock) < 10 && (
            <p className="text-[10px] text-orange-500 font-semibold mt-0.5">{p.japanPart ? "One-off used part" : `Only ${p.stock as number} left`}</p>
          )}
        </div>
      </div>

      <div className="px-3 pb-3">
        <button onClick={e => { e.stopPropagation(); onCart(); }} disabled={Number(p.stock) <= 0}
          className="w-full py-2 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-1.5 transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: Number(p.stock) <= 0 ? "#9CA3AF" : "linear-gradient(135deg,#D4A54A,#B8862E)" }}>
          <ShoppingCart className="w-3.5 h-3.5" />{Number(p.stock) <= 0 ? "Sold out" : "Add to Cart"}
        </button>
      </div>
    </div>
  );
}

// ─── HOME ──────────────────────────────────────────────────────────────────────
// ─── Home: static product rows ────────────────────────────────────────────────
const DEPARTMENTS = [
  "New Arrivals", "Appliances", "Automotive & DIY", "Baby & Toddler", "Beauty",
  "Books & Courses", "Camping & Outdoor", "Clothing & Shoes", "Electronics",
  "Gaming & Media", "Garden, Pool & Patio", "Groceries & Household",
  "Health & Personal Care", "Homeware", "Liquor", "Office & Stationery",
  "Pets", "Sport & Training", "Toys",
];

const NEW_ARRIVALS_SUB = [
  "New to Ballylife", "New in Appliances", "New in Automotive", "New in Baby & Toddler",
  "New in Beauty", "New in Books", "New in Clothing & Shoes", "New in Electronics",
  "New in Gaming", "New in Groceries & Household", "New in Health & Personal Care",
  "New in Homeware", "New in Liquor", "New in Sport", "New in Toys",
];

const CAT_STRIP_LABELS = [
  "Fresh Fashion", "Appliances", "Drinks", "Best Sellers",
  "Brands by Marketplace", "Deals & Promotions", "Brands Store", "Clearance",
];

// Takealot-style compact product card for the homepage rows
function HomeProductCard({ p, onView, onCart }: { p: R; onView: () => void; onCart: () => void }) {
  const discount = p.compareAtPrice
    ? Math.round((1 - Number(p.price) / Number(p.compareAtPrice)) * 100) : 0;
  const imgs = p.images as string[];
  return (
    <div className="bg-white rounded-lg border border-gray-200 flex flex-col cursor-pointer hover:shadow-md transition-shadow min-w-[160px] max-w-[190px] flex-shrink-0 overflow-hidden">
      <div className="relative bg-[#FAFAF9]" style={{ aspectRatio: "3 / 4" }} onClick={onView}>
        <div className="absolute inset-0 flex items-center justify-center text-6xl p-5"
          style={{ background: `linear-gradient(160deg,${productColors(imgs, "#f5f5f5", "#e8e8e8").join(",")})` }}>
          {getProductIllustration(p)
            ? <div className="w-20 h-20" style={{ filter: "drop-shadow(0 8px 10px rgba(0,0,0,0.15))" }}>{getProductIllustration(p)!()}</div>
            : <span style={{ filter: "drop-shadow(0 8px 10px rgba(0,0,0,0.15))" }}>{p.emoji as string}</span>}
          {productPhotos(imgs)[0] && <ProductPhoto src={productPhotos(imgs)[0]} alt={p.name as string} className="p-1.5" />}
        </div>
        {discount > 0 && (
          <div className="absolute top-1 left-1 bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">-{discount}%</div>
        )}
      </div>
      <div className="p-2 flex flex-col flex-1">
        <p className="text-xs text-gray-700 leading-snug mb-1 line-clamp-2">{p.name as string}</p>
        <div className="flex items-center gap-1 mb-1">
          {[1,2,3,4,5].map(s => (
            <svg key={s} width={9} height={9} viewBox="0 0 24 24"
              fill={s <= Math.round(Number(p.rating ?? 4)) ? "#FBBF24" : "#E5E7EB"}>
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          ))}
          <span className="text-[9px] text-gray-500 ml-0.5">({p.reviewCount as number ?? 0})</span>
        </div>
        <div className="mt-auto">
          {p.compareAtPrice && (
            <p className="text-[10px] text-gray-500 line-through">{fmtZAR(Number(p.compareAtPrice))}</p>
          )}
          <p className="text-sm font-bold text-gray-900 mb-2">{fmtZAR(Number(p.price))}</p>
          <button onClick={e => { e.stopPropagation(); onCart(); }}
            className="w-full text-xs font-semibold py-1.5 rounded-md border-2 transition-colors hover:bg-emerald-600 hover:text-white hover:border-emerald-600"
            style={{ borderColor: "#B8862E", color: "#8A6420" }}>
            Add to cart
          </button>
        </div>
      </div>
    </div>
  );
}

function ProductRow({ title, products, onProduct, onCart, slice = [0, 4] }: {
  title: string; products: R[]; onProduct: (p: R) => void;
  onCart: (p: R) => void; slice?: [number, number];
}) {
  const items = products.slice(...slice);
  const { ref, scrollLeft, scrollRight } = useManualSlide<HTMLDivElement>();
  if (!items.length) return null;
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between px-3 py-2 bg-white border-b border-gray-200">
        <span className="font-serif text-base text-gray-900" style={{ fontWeight: 600 }}>{title}</span>
        <button className="text-xs font-semibold" style={{ color: "#8A6420" }}>View more</button>
      </div>
      <div className="relative">
        {items.length > 1 && <SlideArrows onLeft={scrollLeft} onRight={scrollRight} />}
        <div ref={ref} className="flex gap-0 overflow-x-auto scroll-smooth" style={{ scrollbarWidth: "none" }}>
          {items.map((p, i) => (
            <HomeProductCard key={i} p={p}
              onView={() => onProduct(p)}
              onCart={() => onCart(p)} />
          ))}
        </div>
      </div>
    </div>
  );
}

// A single sponsored/promotional slide, distinct from the regular
// product slides -- built as real markup (not an embedded image) so it
// stays crisp at any size and matches the rest of the storefront's
// styling, the same approach used for every other banner on this page.
interface AdSlide {
  image: string;
  alt: string;
  onCta: () => void;
}

/** Hero-eligible: a live product that's in stock and has a real photo. */
function isHeroReady(p: R): boolean {
  return p.status !== "inactive" && Number(p.stock ?? 0) > 0 && productPhotos(p.images).length > 0;
}

function HeroProductSlider({ products, onView, onCart, adSlides = [] }: { products: R[]; onView: (p: R) => void; onCart: (p: R) => void; adSlides?: AdSlide[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  // Products first (only real, in-stock, photographed ones, straight from
  // the live catalogue), then any banner slides, 6 slides in total.
  const items = products.filter(isHeroReady).slice(0, Math.max(0, 6 - adSlides.length));
  const totalSlides = items.length + adSlides.length;
  const adSlide = index >= items.length ? adSlides[index - items.length] : undefined;

  useEffect(() => {
    if (paused || totalSlides < 2) return;
    const id = setInterval(() => setIndex(i => (i + 1) % totalSlides), 6000);
    return () => clearInterval(id);
  }, [totalSlides, paused]);
  useEffect(() => { if (index >= totalSlides) setIndex(0); }, [index, totalSlides]);

  if (totalSlides === 0) return null;
  const go = (i: number) => setIndex((i + totalSlides) % totalSlides);
  const pauseProps = {
    onMouseEnter: () => setPaused(true), onMouseLeave: () => setPaused(false),
    onTouchStart: () => setPaused(true), onTouchEnd: () => setPaused(false),
  };
  const arrows = totalSlides > 1 && (
    <>
      <button onClick={() => go(index - 1)} aria-label="Previous slide"
        className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-white/90 hover:bg-white flex items-center justify-center shadow-md transition-colors">
        <ChevronRight className="w-4 h-4 rotate-180 text-gray-800" />
      </button>
      <button onClick={() => go(index + 1)} aria-label="Next slide"
        className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-white/90 hover:bg-white flex items-center justify-center shadow-md transition-colors">
        <ChevronRight className="w-4 h-4 text-gray-800" />
      </button>
    </>
  );
  const dots = totalSlides > 1 && (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
      {Array.from({ length: totalSlides }).map((_, i) => (
        <button key={i} onClick={() => go(i)} aria-label={`Slide ${i + 1}`} aria-current={index === i}
          className="h-2 rounded-full transition-all" style={{ width: index === i ? 20 : 8, background: index === i ? "#1E7B4D" : "rgba(20,17,13,0.25)" }} />
      ))}
    </div>
  );

  if (adSlide) {
    return (
      <div className="flex-1 relative overflow-hidden rounded-xl h-[340px] sm:h-[400px] bg-white" {...pauseProps}>
        {arrows}
        <button onClick={adSlide.onCta} className="block w-full h-full cursor-pointer" aria-label={adSlide.alt}>
          <img src={adSlide.image} alt={adSlide.alt} className="w-full h-full object-cover" />
        </button>
        {dots}
      </div>
    );
  }

  const p = items[index];
  const discount = p.compareAtPrice ? Math.round((1 - Number(p.price) / Number(p.compareAtPrice)) * 100) : 0;
  const photo = productPhotos(p.images)[0];
  const stock = Number(p.stock ?? 0);

  return (
    <div className="flex-1 relative overflow-hidden rounded-xl h-[340px] sm:h-[400px]" {...pauseProps}
      style={{ background: "linear-gradient(135deg,#FBF3E1 0%,#F3EBD8 100%)", border: "1px solid #E8D9B5" }}>
      {arrows}
      <div className="h-full grid grid-cols-[1fr_1.15fr] sm:grid-cols-2 cursor-pointer" onClick={() => onView(p)}>
        {/* Copy */}
        <div className="min-w-0 flex flex-col justify-center pl-11 sm:pl-16 pr-2 sm:pr-3 py-6">
          <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-emerald-700 mb-2">Featured today</span>
          {discount > 0 && (
            <span className="self-start bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded mb-2">-{discount}% OFF</span>
          )}
          <p className="text-base sm:text-2xl font-bold text-gray-900 leading-snug line-clamp-3 mb-3">{p.name as string}</p>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-2xl sm:text-4xl font-black" style={{ color: "#8A6420" }}>{fmtZAR(Number(p.price))}</span>
            {p.compareAtPrice && <span className="text-xs sm:text-sm text-gray-500 line-through">{fmtZAR(Number(p.compareAtPrice))}</span>}
          </div>
          <p className="text-[11px] sm:text-xs text-gray-600 mt-1.5">
            {p.shippingIncluded ? "Delivery included" : "Fast local delivery"}{stock <= 10 ? ` · Only ${stock} left` : ""}
          </p>
          <button onClick={e => { e.stopPropagation(); onCart(p); }}
            className="self-start mt-4 bg-emerald-700 text-white text-sm font-bold px-6 py-2.5 rounded-lg hover:bg-emerald-800 transition-colors">
            Add to cart
          </button>
        </div>
        {/* Photo: about half the banner, full height, uncropped on white */}
        <div className="relative m-3 sm:m-4 ml-0 sm:ml-0 rounded-lg bg-white overflow-hidden shadow-sm">
          <ProductPhoto key={photo} src={photo} alt={p.name as string} className="p-3 sm:p-5" eager />
        </div>
      </div>
      {dots}
    </div>
  );
}

function HomeView({ categories, products, onCategory, onProduct, onCart, wishlistIds, onWishlist, onFooterLink }: {
  categories: R[]; products: R[];
  onCategory: () => void; onProduct: (p: R) => void;
  onCart: (p: R) => void; wishlistIds: Set<string>; onWishlist: (id: string) => void; onFooterLink: (label: string) => void;
}) {
  const featured = products.filter(p => p.isFeatured);
  const topPicks = products.slice(0, 78);
  const sellers = Array.from(new Set(products.map(p => p.sellerName as string))).slice(0, 6);
  const brands = Array.from(new Set(products.map(p => p.brand as string))).filter(Boolean).slice(0, 8);

  const [recentIds, setRecentIds] = useState<string[]>([]);
  useEffect(() => { setRecentIds(getRecentlyViewed()); }, []);
  const isStandalone = useIsStandalone();
  const recentProducts = recentIds
    .map(id => products.find(p => String(p.id) === id))
    .filter((p): p is R => Boolean(p));
  const brandsSlide = useManualSlide<HTMLDivElement>();

  const BENEFITS = [
    { icon: <Truck className="w-4 h-4" />,   label: "Delivery Included", sub: "On Ballylife store items" },
    { icon: <Shield className="w-4 h-4" />,  label: "Secure Payments",  sub: "100% safe & secure" },
    { icon: <RotateCcw className="w-4 h-4" />, label: "Easy Returns",   sub: "7 day return policy" },
    { icon: <User className="w-4 h-4" />,    label: "Ballylife Support", sub: "We're here to help" },
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50" style={{ scrollbarWidth: "thin" }}>

      {/* ── Hero: sliding featured product + benefit cards ── */}
      <div className="flex flex-col sm:flex-row gap-3 m-3 sm:m-4">
        <div className="flex-1 min-w-0 h-[340px] sm:h-[400px]">
          <HeroProductSlider
            products={featured.filter(isHeroReady).length >= 3 ? featured : products}
            onView={onProduct}
            onCart={onCart}
            // Brand adverts (Samsung, Nike, Apple) were removed: they showed
            // products this store doesn't sell. The slider now features real
            // listings, after our own business banner.
            adSlides={[
              {
                image: businessBoardroomAd,
                alt: "Ballylife for Business - Great Ideas. Stronger Together.",
                onCta: () => onFooterLink("Ballylife for Business"),
              },
            ]}
          />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-1 gap-2 sm:w-56 flex-shrink-0">
          {BENEFITS.map((b, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 p-3 flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: "#FBF3E1", color: "#8A6420" }}>{b.icon}</span>
              <div className="min-w-0">
                <p className="text-xs font-bold text-gray-900 leading-tight">{b.label}</p>
                <p className="text-[10px] text-gray-500 leading-tight truncate">{b.sub}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Featured Brands ── */}
      {brands.length > 0 && (
        <div className="bg-white mx-3 sm:mx-4 mb-3 rounded-2xl p-4">
          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-[0.15em] mb-3">Featured Brands</p>
          <div className="relative">
            {brands.length > 1 && <SlideArrows onLeft={brandsSlide.scrollLeft} onRight={brandsSlide.scrollRight} />}
            <div ref={brandsSlide.ref} className="flex items-center gap-8 overflow-x-auto scroll-smooth px-8 divide-x divide-gray-100" style={{ scrollbarWidth: "none" }}>
              {brands.map((b) => (
                <span key={b} className="shrink-0 font-serif text-xl text-gray-700 hover:text-[#8A6420] transition-colors whitespace-nowrap cursor-default pl-8 first:pl-0" style={{ fontWeight: 700 }}>
                  {b}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Pick Up Where You Left Off — editorial two-column layout,
          matching the supplied reference: a full product card (photo,
          name, price, rating) on the left, and a headline/description/
          feature-icons/CTA block on the right. ── */}
      {recentProducts.length > 0 && (() => {
        const p = recentProducts[0];
        const imgs = p.images as string[];
        const discount = p.compareAtPrice ? Math.round((1 - Number(p.price) / Number(p.compareAtPrice)) * 100) : 0;
        return (
          <div className="relative overflow-hidden mx-3 sm:mx-4 mb-3 rounded-2xl bg-white border border-gray-100">
            <button onClick={() => { clearRecentlyViewed(); setRecentIds([]); }}
              className="absolute top-4 right-4 sm:top-6 sm:right-6 z-10 text-[11px] font-semibold text-gray-500 hover:text-gray-600 transition-colors">
              Clear All
            </button>

            <div className="grid sm:grid-cols-2 gap-6 sm:gap-10 p-4 sm:p-8">
              {/* Product card */}
              <div className="rounded-xl overflow-hidden border border-gray-100 cursor-pointer" onClick={() => onProduct(p)}>
                <div className="relative" style={{ aspectRatio: "16 / 11", background: `linear-gradient(160deg,${productColors(imgs, "#F3F4F6", "#E5E7EB").join(",")})` }}>
                  <div className="absolute inset-0 flex items-center justify-center text-7xl p-8" style={{ filter: "drop-shadow(0 14px 16px rgba(0,0,0,0.18))" }}>
                    {getProductIllustration(p) ? <div className="w-28 h-28">{getProductIllustration(p)!()}</div> : (p.emoji as string)}
                  </div>
                  {productPhotos(imgs)[0] && <ProductPhoto src={productPhotos(imgs)[0]} alt={p.name as string} className="p-3" />}
                  {discount > 0 && (
                    <span className="absolute top-3 left-3 bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">-{discount}%</span>
                  )}
                </div>
                <div className="p-4 sm:p-5">
                  <p className="text-base sm:text-lg font-semibold text-gray-900 mb-1.5 line-clamp-1">{p.name as string}</p>
                  <p className="text-xl sm:text-2xl font-bold mb-2" style={{ color: "#8C6420" }}>{fmtZAR(Number(p.price))}</p>
                  <div className="flex items-center gap-1.5">
                    <Stars rating={Number(p.avgRating)} size={14} />
                    <span className="text-xs text-gray-500">{Number(p.avgRating).toFixed(1)} ({Number(p.reviewCount ?? 0).toLocaleString()})</span>
                  </div>
                </div>
              </div>

              {/* Text content */}
              <div className="flex flex-col justify-center">
                <span className="text-[11px] font-bold tracking-[0.15em] uppercase mb-3" style={{ color: "#8A6420" }}>Just for You</span>
                <h3 className="font-serif font-bold leading-[1.08] text-gray-900 mb-4" style={{ fontSize: "clamp(24px,3.6vw,38px)" }}>
                  Pick Up Where<br />You Left Off
                </h3>
                <p className="text-sm sm:text-base text-gray-500 leading-relaxed mb-5 max-w-md">
                  Good taste doesn't need reminding — but here it is anyway. Still there. Still yours if you want it.
                </p>
                <div className="flex items-center gap-4 sm:gap-6 mb-6 flex-wrap">
                  {[
                    { icon: <Heart className="w-5 h-5" />, label: "Saved for You" },
                    { icon: <CheckCircle className="w-5 h-5" />, label: "Still Available" },
                    { icon: <Zap className="w-5 h-5" />, label: "Quick Checkout" },
                  ].map((f, i) => (
                    <div key={f.label} className={`flex items-center gap-2 ${i > 0 ? "sm:pl-6 sm:border-l sm:border-gray-200" : ""}`}>
                      <span style={{ color: "#8A6420" }}>{f.icon}</span>
                      <span className="text-xs sm:text-sm text-gray-600 font-medium">{f.label}</span>
                    </div>
                  ))}
                </div>
                <button onClick={onCategory} className="inline-flex items-center gap-2 w-fit text-white font-bold px-6 py-3 rounded-lg transition-transform hover:scale-[1.02]"
                  style={{ background: "#8C6420" }}>
                  View More <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── What to Explore Next — 6 across ── */}
      {topPicks.length > 0 && (
        <div className="bg-white mx-3 sm:mx-4 mb-3 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: "#FBF3E1", color: "#8A6420" }}>
                <ShoppingBag className="w-5 h-5" />
              </span>
              <span className="font-serif text-lg text-gray-900" style={{ fontWeight: 600 }}>What to Explore Next</span>
            </div>
            <button onClick={onCategory} className="flex items-center gap-1 text-sm font-semibold" style={{ color: "#8A6420" }}>
              View All <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {topPicks.map((p, i) => (
              <Fragment key={i}>
                <ProductCard p={p} onView={() => onProduct(p)} onCart={() => onCart(p)}
                  wishlistIds={wishlistIds} onWishlist={() => onWishlist(String(p.id))} />
                {(i === 53 || i === 65) && <PromoBanner onShop={onCategory} />}
              </Fragment>
            ))}
          </div>
        </div>
      )}

      {/* ── Trusted sellers ── */}
      {sellers.length > 0 && (
        <div className="relative overflow-hidden mx-3 sm:mx-4 mb-3 rounded-2xl p-6 sm:p-10 flex flex-col sm:flex-row sm:items-center justify-between gap-6 sm:gap-10"
          style={{ background: "linear-gradient(135deg,#14110D 0%,#211C16 55%,#14110D 100%)" }}>
          {/* Scattered shield-checkmark watermark -- a genuinely different
              texture from the two-blob glow used on "Pick Up Where You
              Left Off" above, and thematically tied to "verified" rather
              than reusing the same decorative trick with new colors. */}
          <div className="absolute inset-0 pointer-events-none select-none overflow-hidden opacity-[0.06]">
            {Array.from({ length: 18 }).map((_, i) => {
              const row = Math.floor(i / 6);
              const col = i % 6;
              return (
                <svg key={i} width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#D4A54A" strokeWidth="1.6"
                  style={{ position: "absolute", top: `${row * 42 - 10}%`, left: `${col * 19 + (row % 2 === 0 ? 0 : 9)}%`, transform: `rotate(${(i % 5) * 7 - 14}deg)` }}>
                  <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
              );
            })}
          </div>
          {/* One asymmetric accent glow, not a matching pair */}
          <div className="absolute -bottom-24 -right-16 rounded-full opacity-20 pointer-events-none" style={{ width: 320, height: 320, background: "radial-gradient(circle,#D4A54A 0%,transparent 70%)" }} />

          <div className="relative shrink-0 text-center sm:text-left">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold mb-3" style={{ background: "rgba(212,165,74,0.15)", color: "#D4A54A" }}>
              <Shield className="w-3 h-3" /> VERIFIED MARKETPLACE
            </span>
            <h3 className="font-serif leading-tight mb-3" style={{ fontWeight: 700, fontSize: "clamp(24px,4vw,40px)" }}>
              <span className="text-white">Shop from</span><br />
              <span style={{ background: "linear-gradient(135deg,#D4A54A,#F0C878)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>trusted sellers</span>
            </h3>
            <p className="text-sm sm:text-base max-w-md mx-auto sm:mx-0" style={{ color: "rgba(255,255,255,0.65)" }}>
              No guesswork, no gambles. Every seller on Ballylife is verified before they ever list a thing.
            </p>
          </div>
          <div className="relative flex items-center gap-2.5 flex-wrap justify-center sm:justify-end">
            {sellers.map((s) => (
              <button key={s} onClick={onCategory} className="px-5 py-3 rounded-xl text-sm font-bold bg-white/10 text-white hover:bg-white/20 hover:scale-[1.03] transition-all whitespace-nowrap border border-white/10">
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Trust badges ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mx-3 sm:mx-4 mb-4">
        {[
          { icon: <Shield className="w-4 h-4" />, label: "Trusted Quality", sub: "Genuine products from verified sellers" },
          { icon: <TrendingUp className="w-4 h-4" />, label: "Best Prices", sub: "We offer unbeatable prices everyday" },
          { icon: <Package className="w-4 h-4" />, label: "Secure Shopping", sub: "Your data and payments are always safe" },
          { icon: <User className="w-4 h-4" />, label: "Customer Support", sub: "Friendly support whenever you need us" },
        ].map((b, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "#FBF3E1", color: "#8A6420" }}>{b.icon}</span>
            <div>
              <p className="text-xs font-bold text-gray-900">{b.label}</p>
              <p className="text-[10px] text-gray-500 leading-snug">{b.sub}</p>
            </div>
          </div>
        ))}
      </div>

      {!isStandalone && <Footer onLinkClick={onFooterLink} />}
    </div>
  );
}

// ─── CATALOG ──────────────────────────────────────────────────────────────────
function CatalogView({ categories, onProduct, onCart, wishlistIds, onWishlist, initialSearch, onFooterLink }: {
  categories: R[]; onProduct: (p: R) => void; onCart: (p: R) => void;
  wishlistIds: Set<string>; onWishlist: (id: string) => void; initialSearch?: string; onFooterLink: (label: string) => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState<R[]>([]);
  const [loading, setLoading]   = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage]         = useState(1);
  const [hasMore, setHasMore]   = useState(true);
  // category/search are seeded from the URL first (so a shared or
  // bookmarked /catalog?category=electronics link actually lands on
  // that filtered view), falling back to initialSearch (set when
  // arriving here from the header search box) or empty.
  const [search, setSearch]     = useState(searchParams.get("search") ?? initialSearch ?? "");
  const [activeCat, setActiveCat] = useState(searchParams.get("category") ?? "");
  const [sort, setSort]         = useState(searchParams.get("sort") ?? "popular");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const isStandalone = useIsStandalone();

  // Keeps the URL's query string reflecting the current filters -- so
  // this page has a real, distinct, shareable/indexable address per
  // category or search term instead of one generic /catalog URL no
  // matter what's being browsed.
  useEffect(() => {
    const next = new URLSearchParams();
    if (activeCat) next.set("category", activeCat);
    if (search) next.set("search", search);
    if (sort !== "popular") next.set("sort", sort);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCat, search, sort]);

  // Vehicle-specific filters — only shown/applied when browsing the
  // Vehicles category itself (not its Parts & Equipment subcategory,
  // where body type/mileage etc. don't mean anything).
  const [vCondition, setVCondition] = useState("");
  const [vBodyType, setVBodyType] = useState("");
  const [vFuelType, setVFuelType] = useState("");
  const [vTransmission, setVTransmission] = useState("");
  const [vMinYear, setVMinYear] = useState("");
  const [vMaxYear, setVMaxYear] = useState("");
  const [vMaxMileage, setVMaxMileage] = useState("");
  const activeCategory = categories.find(c => String(c.id) === activeCat);
  const isVehicleCategory = activeCategory?.slug === "vehicles";

  useEffect(() => { if (initialSearch) setSearch(initialSearch); }, [initialSearch]);
  useEffect(() => { if (!isVehicleCategory) { setVCondition(""); setVBodyType(""); setVFuelType(""); setVTransmission(""); setVMinYear(""); setVMaxYear(""); setVMaxMileage(""); } }, [isVehicleCategory]);

  const load = useCallback(async () => {
    setLoading(true);
    setPage(1);
    try {
      const params: Record<string, string> = { category: activeCat, search, sort, limit: "78", page: "1" };
      if (isVehicleCategory) {
        if (vCondition) params.condition = vCondition;
        if (vBodyType) params.bodyType = vBodyType;
        if (vFuelType) params.fuelType = vFuelType;
        if (vTransmission) params.transmission = vTransmission;
        if (vMinYear) params.minYear = vMinYear;
        if (vMaxYear) params.maxYear = vMaxYear;
        if (vMaxMileage) params.maxMileage = vMaxMileage;
      }
      const res = await mktProducts.list(params);
      setProducts(res.data as R[]);
      setHasMore(Number(res.meta?.pages ?? 1) > 1);
    } catch (err) { showLoadError(err); } finally { setLoading(false); }
  }, [activeCat, search, sort, isVehicleCategory, vCondition, vBodyType, vFuelType, vTransmission, vMinYear, vMaxYear, vMaxMileage]);

  useEffect(() => { load(); }, [load]);

  // Infinite scroll: a sentinel just above the footer triggers the next
  // page as it comes into view, appending rather than replacing --
  // browsing "All" (or any category) never has to hit a dead end at a
  // fixed 78 items, it keeps going for as long as the catalog does.
  const loadMore = useCallback(async () => {
    if (loadingMore || loading || !hasMore) return;
    setLoadingMore(true);
    const nextPage = page + 1;
    try {
      const params: Record<string, string> = { category: activeCat, search, sort, limit: "78", page: String(nextPage) };
      if (isVehicleCategory) {
        if (vCondition) params.condition = vCondition;
        if (vBodyType) params.bodyType = vBodyType;
        if (vFuelType) params.fuelType = vFuelType;
        if (vTransmission) params.transmission = vTransmission;
        if (vMinYear) params.minYear = vMinYear;
        if (vMaxYear) params.maxYear = vMaxYear;
        if (vMaxMileage) params.maxMileage = vMaxMileage;
      }
      const res = await mktProducts.list(params);
      setProducts(prev => [...prev, ...(res.data as R[])]);
      setPage(nextPage);
      setHasMore(nextPage < Number(res.meta?.pages ?? 1));
    } catch (err) { showLoadError(err); } finally { setLoadingMore(false); }
  }, [loadingMore, loading, hasMore, page, activeCat, search, sort, isVehicleCategory, vCondition, vBodyType, vFuelType, vTransmission, vMinYear, vMaxYear, vMaxMileage]);

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) loadMore();
    }, { rootMargin: "600px" }); // fire well before the sentinel is actually visible, so more loads in ahead of the user reaching it
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Top filters bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-white flex-shrink-0 flex-wrap">
        {/* Active search / category context, if any */}
        <div className="flex-1 min-w-[120px] font-serif text-base text-gray-800" style={{ fontWeight: 600 }}>
          {search ? `Results for "${search}"` : "All products"}
        </div>
        {/* Sort */}
        <select value={sort} onChange={e => setSort(e.target.value)}
          className="text-xs border border-gray-200 rounded-xl px-3 py-2 outline-none bg-white focus:border-emerald-400">
          <option value="popular">Most Popular</option>
          <option value="rating">Top Rated</option>
          <option value="price_asc">Price ↑</option>
          <option value="price_desc">Price ↓</option>
          <option value="newest">Newest</option>
          {isVehicleCategory && <option value="year_desc">Newest Model Year</option>}
          {isVehicleCategory && <option value="mileage_asc">Lowest Mileage</option>}
        </select>
        {/* View toggle */}
        <div className="flex border border-gray-200 rounded-xl overflow-hidden">
          <button onClick={() => setViewMode("grid")}
            className={`p-2 transition-colors ${viewMode === "grid" ? "bg-emerald-50 text-emerald-700" : "text-gray-500"}`}>
            <Grid className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setViewMode("list")}
            className={`p-2 transition-colors ${viewMode === "list" ? "bg-emerald-50 text-emerald-700" : "text-gray-500"}`}>
            <List className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Category pills */}
      <div className="flex items-center gap-2 px-4 py-2.5 overflow-x-auto scrollbar-none border-b border-gray-50 bg-white flex-shrink-0">
        {[{ id: "", name: "All", icon: "🛍️" }, ...categories].map((c, i) => (
          <button key={i} onClick={() => setActiveCat(String(c.id ?? ""))}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all"
            style={{
              background: activeCat === String(c.id ?? "") ? "#B8862E" : "#F3F4F6",
              color: activeCat === String(c.id ?? "") ? "white" : "#374151",
            }}>
            {c.icon as string} {c.name as string}
          </button>
        ))}
      </div>

      {/* Vehicle-specific filters — only when browsing the Vehicles category */}
      {isVehicleCategory && (
        <div className="flex items-center gap-2 px-4 py-2.5 overflow-x-auto scrollbar-none border-b border-gray-50 bg-white flex-shrink-0 flex-wrap">
          <select value={vCondition} onChange={e => setVCondition(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none bg-white">
            <option value="">Any condition</option>
            <option value="new">New</option>
            <option value="used">Used</option>
          </select>
          <select value={vBodyType} onChange={e => setVBodyType(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none bg-white">
            <option value="">Any body type</option>
            {["sedan", "hatchback", "station_wagon", "suv", "pickup_single_cab", "pickup_double_cab", "panel_van"].map(b => (
              <option key={b} value={b}>{b.replace(/_/g, " ")}</option>
            ))}
          </select>
          <select value={vFuelType} onChange={e => setVFuelType(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none bg-white">
            <option value="">Any fuel type</option>
            <option value="petrol">Petrol</option>
            <option value="diesel">Diesel</option>
            <option value="hybrid">Hybrid</option>
            <option value="electric">Electric</option>
          </select>
          <select value={vTransmission} onChange={e => setVTransmission(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none bg-white">
            <option value="">Any transmission</option>
            <option value="automatic">Automatic</option>
            <option value="manual">Manual</option>
          </select>
          <input type="number" placeholder="Year from" value={vMinYear} onChange={e => setVMinYear(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none bg-white w-24" />
          <input type="number" placeholder="Year to" value={vMaxYear} onChange={e => setVMaxYear(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none bg-white w-24" />
          <input type="number" placeholder="Max mileage (km)" value={vMaxMileage} onChange={e => setVMaxMileage(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none bg-white w-36" />
          {(vCondition || vBodyType || vFuelType || vTransmission || vMinYear || vMaxYear || vMaxMileage) && (
            <button onClick={() => { setVCondition(""); setVBodyType(""); setVFuelType(""); setVTransmission(""); setVMinYear(""); setVMaxYear(""); setVMaxMileage(""); }}
              className="text-xs font-semibold text-gray-500 hover:text-gray-800 hover:underline">
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Products */}
      <div className="flex-1 overflow-y-auto p-4" style={{ background: "#FAF6EC" }}>
        {!loading && !activeCat && !search && products.length > 0 && (
          <div className="-mx-4 -mt-4 mb-4">
            <ProductRow title="Popular right now" products={products} onProduct={onProduct} onCart={onCart} slice={[0, 10]} />
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#8A6420" }} />
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <Search className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="font-semibold">No products found</p>
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {products.map((p, i) => (
              <ProductCard key={i} p={p} onView={() => onProduct(p)} onCart={() => onCart(p)}
                wishlistIds={wishlistIds} onWishlist={() => onWishlist(String(p.id))} />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {products.map((p, i) => {
              const imgs = p.images as string[];
              return (
                <div key={i} className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-4 hover:shadow-md cursor-pointer transition-all" onClick={() => onProduct(p)}>
                  <div className="relative w-20 h-20 rounded-xl flex items-center justify-center text-3xl flex-shrink-0 overflow-hidden"
                    style={{ background: `linear-gradient(135deg,${productColors(imgs, "#F3F4F6", "#E5E7EB").join(",")})` }}>
                    <div style={{ filter: "drop-shadow(0 6px 8px rgba(0,0,0,0.15))" }}>
                      {getProductIllustration(p)
                        ? <div className="w-14 h-14">{getProductIllustration(p)!()}</div>
                        : (p.emoji as string)}
                    </div>
                    {productPhotos(imgs)[0] && <ProductPhoto src={productPhotos(imgs)[0]} alt={p.name as string} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-500">{p.brand as string}</p>
                    <p className="text-sm font-semibold text-gray-900 truncate">{p.name as string}</p>
                    <div className="flex items-center gap-1 mt-0.5"><Stars rating={Number(p.avgRating)} size={11} /></div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-base font-black text-gray-900">{fmtZAR(Number(p.price))}</p>
                    {p.compareAtPrice && <p className="text-xs text-gray-500 line-through">{fmtZAR(Number(p.compareAtPrice))}</p>}
                    <button onClick={e => { e.stopPropagation(); onCart(p); }}
                      className="mt-1 px-3 py-1 rounded-lg text-xs font-bold text-white" style={{ background: "#B8862E" }}>
                      Add
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {!loading && products.length > 0 && (
          <div ref={sentinelRef} className="flex items-center justify-center py-8">
            {loadingMore ? (
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: "#8A6420" }} />
            ) : !hasMore ? (
              <p className="text-xs text-gray-500">You've reached the end — {products.length.toLocaleString()} products shown</p>
            ) : null}
          </div>
        )}
        {!isStandalone && <Footer onLinkClick={onFooterLink} />}
      </div>
    </div>
  );
}

// ─── PRODUCT DETAIL ───────────────────────────────────────────────────────────
function ProductDetailView({ productId, onBack, onCart, wishlistIds, onWishlist, authUser, onRequireAuth, onFooterLink }: {
  productId: string; onBack: () => void;
  onCart: (p: R, variantId?: string) => void;
  wishlistIds: Set<string>; onWishlist: (id: string) => void;
  authUser: { id: string; name: string } | null; onRequireAuth: () => void; onFooterLink: (label: string) => void;
}) {
  const [data, setData]   = useState<{ product: R; seller: R; reviews: R[]; related: R[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [qty, setQty]     = useState(1);
  const [selVariant, setSelVariant] = useState("");
  const [tab, setTab]     = useState<"desc" | "reviews" | "seller">("desc");
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewTitle, setReviewTitle] = useState("");
  const [reviewBody, setReviewBody] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const [show3D, setShow3D] = useState(false);
  const isStandalone = useIsStandalone();

  const submitReview = async () => {
    if (!authUser) { onRequireAuth(); return; }
    if (!reviewRating) return;
    setSubmittingReview(true);
    try {
      const res = await mktProducts.addReview(productId, { userId: authUser.id, rating: reviewRating, title: reviewTitle, body: reviewBody });
      if ((res as { success: boolean }).success) {
        setReviewSubmitted(true);
        setReviewRating(0); setReviewTitle(""); setReviewBody("");
        mktProducts.get(productId).then(r => setData(r.data as typeof data));
      }
    } catch (err) { showLoadError(err); } finally { setSubmittingReview(false); }
  };

  useEffect(() => {
    setLoading(true);
    setShow3D(false);
    mktProducts.get(productId)
      .then(res => {
        const d = res.data as typeof data;
        setData(d);
        addRecentlyViewed(productId);
        if (d?.product) {
          const name = String(d.product.name ?? "Product");
          const rawDesc = String(d.product.description ?? "").replace(/\s+/g, " ").trim();
          // Meta descriptions much beyond ~155 chars just get cut off in
          // a search snippet anyway, and this app's product descriptions
          // are multi-paragraph -- take the first sentence-ish chunk
          // rather than a mid-word cut.
          const shortDesc = rawDesc.length > 155 ? rawDesc.slice(0, 155).replace(/\s+\S*$/, "") + "…" : rawDesc;
          setPageMeta(`${name} — Ballylife`, shortDesc || undefined);
        }
      })
      .catch(showLoadError)
      .finally(() => setLoading(false));
  }, [productId]);

  if (loading) return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin" style={{ color: "#8A6420" }} /></div>;
  if (!data) return null;

  const { product: p, seller, reviews, related } = data;
  const inWishlist = wishlistIds.has(p.id as string);
  const variants   = (p.variants as R[]) ?? [];
  const discount   = p.compareAtPrice ? Math.round((1 - Number(p.price) / Number(p.compareAtPrice)) * 100) : 0;
  const variantTypes = [...new Set(variants.map(v => v.type as string))];
  const imgs = p.images as string[];

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: "#FAF6EC" }}>
      {/* Back bar */}
      <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-100">
        <button onClick={onBack} aria-label="Back" className="p-1.5 rounded-lg hover:bg-gray-100"><ArrowLeft className="w-4 h-4 text-gray-700" /></button>
        <p className="text-sm font-semibold text-gray-900 flex-1 truncate">{p.name as string}</p>
        <button onClick={() => onWishlist(p.id as string)}>
          <Heart className={`w-5 h-5 ${inWishlist ? "fill-red-500 text-red-500" : "text-gray-500"}`} />
        </button>
      </div>

      <div className="grid xl:grid-cols-2">
        {/* Image */}
        <div>
          {show3D ? (
            <div>
              <div className="flex items-center justify-between px-3 pt-2">
                <button onClick={() => setShow3D(false)} className="flex items-center gap-1 text-xs font-semibold text-gray-600 hover:text-gray-900">
                  <ArrowLeft className="w-3.5 h-3.5" /> Back to photos
                </button>
              </div>
              <Product3DViewer
                key={productId}
                emoji={p.emoji as string}
                colorA={productColors(imgs, "#B8862E", "#0F3D24")[0]}
                colorB={productColors(imgs, "#B8862E", "#0F3D24")[1]}
                brand={(p.brand as string) ?? ""}
                name={p.name as string}
                discount={discount}
                illustration={getProductIllustration(p)}
                photos={productPhotos(imgs)}
              />
            </div>
          ) : (
            <ProductPhotoGallery
              key={productId}
              emoji={p.emoji as string}
              colorA={productColors(imgs, "#B8862E", "#0F3D24")[0]}
              colorB={productColors(imgs, "#B8862E", "#0F3D24")[1]}
              photos={productPhotos(imgs)}
              name={p.name as string}
              discount={discount}
              illustration={getProductIllustration(p)}
              onOpen3DView={() => setShow3D(true)}
            />
          )}
          {p.isFlashDeal && (
            <div className="mx-4 my-3 flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-100">
              <Zap className="w-4 h-4 text-red-500 flex-shrink-0" />
              <p className="text-xs text-red-700 font-semibold">Flash Deal! Limited time offer.</p>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="p-6 bg-white border-l border-gray-50 space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold">{p.categoryName as string}</span>
              <span className="text-xs text-gray-500">{p.brand as string}</span>
            </div>
            <h1 className="font-serif text-2xl text-gray-900 leading-snug" style={{ fontWeight: 600 }}>{p.name as string}</h1>
          </div>

          <div className="flex items-center gap-3">
            <Stars rating={Number(p.avgRating)} size={15} />
            <span className="text-sm font-bold text-gray-700">{Number(p.avgRating).toFixed(1)}</span>
            <span className="text-sm text-gray-500">({Number(p.reviewCount).toLocaleString()} reviews)</span>
          </div>

          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-black text-gray-900">{fmtZAR(Number(p.price))}</span>
            {p.compareAtPrice && (
              <>
                <span className="text-lg text-gray-500 line-through">{fmtZAR(Number(p.compareAtPrice))}</span>
                <span className="text-sm font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">Save {discount}%</span>
              </>
            )}
          </div>

          {/* Variants */}
          {variantTypes.map(type => (
            <div key={type}>
              <p className="text-xs font-bold text-gray-600 mb-2 uppercase tracking-wider">{type}</p>
              <div className="flex flex-wrap gap-2">
                {variants.filter(v => v.type === type).map((v, i) => (
                  <button key={i} onClick={() => setSelVariant(v.id as string)}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all"
                    style={{
                      background: selVariant === v.id ? "#B8862E" : "white",
                      color: selVariant === v.id ? "white" : "#374151",
                      borderColor: selVariant === v.id ? "#B8862E" : "#E5E7EB",
                    }}>
                    {v.value as string}
                    {Number(v.additionalPrice) > 0 && <span className="ml-1 opacity-70">+{fmtZAR(Number(v.additionalPrice))}</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {/* Qty */}
          <div>
            <p className="text-xs font-bold text-gray-600 mb-2 uppercase tracking-wider">Quantity</p>
            <div className="flex items-center gap-3">
              <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden">
                <button onClick={() => setQty(q => Math.max(1, q - 1))} className="px-3 py-2 hover:bg-gray-50"><Minus className="w-3.5 h-3.5 text-gray-600" /></button>
                <span className="px-4 text-sm font-bold">{qty}</span>
                <button onClick={() => setQty(q => Math.min(Number(p.stock), q + 1))} className="px-3 py-2 hover:bg-gray-50"><Plus className="w-3.5 h-3.5 text-gray-600" /></button>
              </div>
              <span className="text-xs text-gray-500">{Number(p.stock)} in stock</span>
            </div>
          </div>

          {p.japanPart && <JapanPartDisclosure part={p.japanPart as R} deliveryWindow={deliveryWindowFor(p)} soldOut={Number(p.stock) <= 0} />}

          {/* Delivery */}
          <div className="flex items-center gap-2.5 p-3 rounded-xl bg-green-50 border border-green-100">
            <Truck className="w-4 h-4 text-green-600 flex-shrink-0" />
            <div>
              <p className="text-xs font-semibold text-green-700">{p.shippingIncluded ? "Delivery included in the price" : Number(p.price) > 500 ? "Free delivery" : "R99 delivery"}</p>
              <p className="text-[10px] text-green-600">Estimated {deliveryWindowFor(p)}{p.shippingIncluded ? " to your door" : ""}</p>
            </div>
          </div>

          {/* CTAs */}
          <div className="flex gap-3">
            <button onClick={() => onCart(p, selVariant || undefined)} disabled={Number(p.stock) <= 0}
              className="flex-1 py-3 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:cursor-not-allowed"
              style={{ background: Number(p.stock) <= 0 ? "#9CA3AF" : "linear-gradient(135deg,#D4A54A,#B8862E)" }}>
              <ShoppingCart className="w-4 h-4" />{Number(p.stock) <= 0 ? "Sold out" : "Add to Cart"}
            </button>
            <button onClick={() => onWishlist(p.id as string)}
              className={`px-4 rounded-2xl border transition-all ${inWishlist ? "bg-red-50 border-red-200" : "border-gray-200"}`}>
              <Heart className={`w-4 h-4 ${inWishlist ? "fill-red-500 text-red-500" : "text-gray-500"}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-t border-gray-100 px-6">
        <div className="flex border-b border-gray-100">
          {(["desc","reviews","seller"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-3.5 text-sm font-semibold transition-all border-b-2 -mb-px capitalize ${tab === t ? "border-emerald-600 text-emerald-600" : "border-transparent text-gray-500"}`}>
              {t === "desc" ? "Description" : t === "reviews" ? `Reviews (${reviews.length})` : "Seller"}
            </button>
          ))}
        </div>
        <div className="py-5">
          {tab === "desc" && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{p.description as string}</p>
              {Object.keys(p.attributes as R ?? {}).length > 0 && (
                <div>
                  <p className="text-sm font-bold text-gray-800 mb-3">Specifications</p>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(p.attributes as R ?? {}).map(([k, v]) => (
                      <div key={k} className="flex justify-between text-sm py-2 border-b border-gray-50">
                        <span className="text-gray-500">{k}</span>
                        <span className="font-medium text-gray-800">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {(p.tags as string[] ?? []).map((t, i) => (
                  <span key={i} className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">#{t}</span>
                ))}
              </div>
            </div>
          )}
          {tab === "reviews" && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl border border-gray-100">
                <p className="text-sm font-bold text-gray-900 mb-2">Write a review</p>
                {reviewSubmitted ? (
                  <p className="text-sm text-green-600 flex items-center gap-1.5"><CheckCircle className="w-4 h-4" /> Thanks — your review has been posted.</p>
                ) : (
                  <>
                    <div className="flex items-center gap-1 mb-2">
                      {[1, 2, 3, 4, 5].map(n => (
                        <button key={n} onClick={() => setReviewRating(n)} aria-label={`${n} star`}>
                          <Star className={`w-5 h-5 ${n <= reviewRating ? "fill-amber-400 text-amber-400" : "text-gray-300"}`} />
                        </button>
                      ))}
                    </div>
                    <input value={reviewTitle} onChange={e => setReviewTitle(e.target.value)} placeholder="Review title (optional)"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2 outline-none focus:border-[#B8862E]" />
                    <textarea value={reviewBody} onChange={e => setReviewBody(e.target.value)} rows={3} placeholder="Share what you liked or didn't..."
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3 outline-none focus:border-[#B8862E]" />
                    <button onClick={submitReview} disabled={!reviewRating || submittingReview}
                      className="px-4 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-50" style={{ background: "#B8862E" }}>
                      {submittingReview ? "Posting..." : authUser ? "Post review" : "Sign in to review"}
                    </button>
                  </>
                )}
              </div>
              {reviews.map((r, i) => (
                <div key={i} className="p-4 rounded-2xl bg-gray-50">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{r.title as string}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Stars rating={Number(r.rating)} size={12} />
                        <span className="text-[11px] text-gray-500">by {r.reviewerName as string}</span>
                        {r.verifiedPurchase && <span className="text-[10px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full">✓ Verified</span>}
                      </div>
                    </div>
                    <span className="text-[11px] text-gray-500">{ago(r.createdAt as string)}</span>
                  </div>
                  <p className="text-sm text-gray-600">{r.body as string}</p>
                </div>
              ))}
              {reviews.length === 0 && <p className="text-sm text-gray-500 text-center py-8">No reviews yet</p>}
            </div>
          )}
          {tab === "seller" && seller && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-2xl">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl" style={{ background: "#EAF7EE" }}>🏪</div>
                <div>
                  <p className="font-bold text-gray-900">{seller.storeName as string}</p>
                  <div className="flex items-center gap-1 mt-0.5"><Stars rating={Number(seller.avgRating ?? 4.5)} size={12} /></div>
                  <p className="text-xs text-gray-500 mt-0.5">{String(seller.description ?? "Trusted Ballylife seller")}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label:"Total Sales", value:Number(seller.totalSales ?? 0).toLocaleString() },
                  { label:"Rating", value:Number(seller.avgRating ?? 4.5).toFixed(1) },
                  { label:"KYC", value:seller.kycVerified ? "✓ Verified" : "Pending" },
                ].map((s, i) => (
                  <div key={i} className="text-center p-3 bg-gray-50 rounded-xl">
                    <p className="text-base font-black text-gray-900">{s.value}</p>
                    <p className="text-[11px] text-gray-500">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Related */}
      {related.length > 0 && (
        <div className="px-4 pb-8 bg-white border-t border-gray-50">
          <h3 className="font-serif text-lg text-gray-900 my-4" style={{ fontWeight: 600 }}>Related Products</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {related.map((r, i) => (
              <ProductCard key={i} p={r} onView={() => onCart(r)} onCart={() => onCart(r)}
                wishlistIds={wishlistIds} onWishlist={() => onWishlist(String(r.id))} />
            ))}
          </div>
        </div>
      )}
      {!isStandalone && <Footer onLinkClick={onFooterLink} />}
    </div>
  );
}

// ─── CART ─────────────────────────────────────────────────────────────────────
function CartView({ cart, onUpdateQty, onRemove, onApplyCoupon, onCheckout }: {
  cart: R | null;
  onUpdateQty: (id: string, qty: number) => void;
  onRemove: (id: string) => void;
  onApplyCoupon: (code: string) => void;
  onCheckout: () => void;
}) {
  const [coupon, setCoupon] = useState("");
  const items = (cart?.items as R[]) ?? [];

  if (items.length === 0) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center" style={{ background: "#FAF6EC" }}>
      <div className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl" style={{ background: "#EAF7EE" }}>🛒</div>
      <h2 className="font-serif text-xl text-gray-900" style={{ fontWeight: 600 }}>Your cart is empty</h2>
      <p className="text-sm text-gray-500">Browse products and add items to get started</p>
    </div>
  );

  return (
    <div className="flex-1 flex overflow-hidden" style={{ background: "#FAF6EC" }}>
      {/* Items */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <h2 className="font-serif text-xl text-gray-900" style={{ fontWeight: 600 }}>Cart ({items.length})</h2>
        {items.map((item, i) => (
          <div key={i} className="bg-white rounded-2xl p-4 flex items-center gap-4 border border-gray-100">
            <div className="relative w-16 h-16 rounded-xl flex items-center justify-center text-3xl flex-shrink-0 bg-gray-50 overflow-hidden">
              {item.emoji as string}
              {productPhotos([item.image])[0] && <ProductPhoto src={productPhotos([item.image])[0]} alt={item.name as string} />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{item.name as string}</p>
              <p className="text-xs text-gray-500">{item.sellerName as string}</p>
              <p className="text-sm font-bold mt-1" style={{ color: "#8A6420" }}>{fmtZAR(Number(item.unitPrice))}</p>
            </div>
            <div className="flex flex-col items-end gap-2 flex-shrink-0">
              <button onClick={() => onRemove(item.productId as string)}>
                <Trash2 className="w-4 h-4 text-gray-300 hover:text-red-500 transition-colors" />
              </button>
              <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden">
                <button onClick={() => onUpdateQty(item.productId as string, Number(item.quantity) - 1)} className="px-2 py-1 hover:bg-gray-50"><Minus className="w-3 h-3 text-gray-600" /></button>
                <span className="px-2 text-xs font-bold">{item.quantity as number}</span>
                <button onClick={() => onUpdateQty(item.productId as string, Number(item.quantity) + 1)} className="px-2 py-1 hover:bg-gray-50"><Plus className="w-3 h-3 text-gray-600" /></button>
              </div>
            </div>
          </div>
        ))}

        {/* Coupon */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <div className="flex items-center gap-2 mb-3">
            <Tag className="w-4 h-4" style={{ color: "#8A6420" }} />
            <p className="text-sm font-semibold text-gray-900">Have a coupon?</p>
          </div>
          <div className="flex gap-2">
            <input value={coupon} onChange={e => setCoupon(e.target.value.toUpperCase())}
              placeholder="e.g. WELCOME10"
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-emerald-400 uppercase" />
            <button onClick={() => onApplyCoupon(coupon)}
              className="px-4 py-2 rounded-xl text-sm font-bold text-white" style={{ background: "#B8862E" }}>Apply</button>
          </div>
          {cart?.couponCode && (
            <p className="text-xs text-green-600 mt-2 font-semibold">
              ✓ {cart.couponCode as string} applied — saving {fmtZAR(Number(cart.couponDiscount))}
            </p>
          )}
          <p className="text-[11px] text-gray-500 mt-1.5">Try: WELCOME10 · SAVE200 · FREESHIP</p>
        </div>
      </div>

      {/* Summary */}
      <div className="w-72 flex-shrink-0 p-4 bg-white border-l border-gray-100 overflow-y-auto">
        <h3 className="font-serif text-base text-gray-900 mb-4" style={{ fontWeight: 600 }}>Order Summary</h3>
        <div className="space-y-2.5 mb-5">
          {[
            { label: "Subtotal",      value: fmtZAR(Number(cart?.subtotal ?? 0)) },
            ...(Number(cart?.memberDiscount) > 0 ? [{ label: "BallylifeMORE saving", value: `-${fmtZAR(Number(cart?.memberDiscount))}` }] : []),
            { label: "Delivery",      value: Number(cart?.shipping) > 0 ? fmtZAR(Number(cart?.shipping)) : items.length && items.every(i => i.shippingIncluded) ? "Included" : "Free" },
            { label: "Estimated",     value: cartDeliveryWindow(items) },
            { label: "Tax (15% VAT)", value: fmtZAR(Number(cart?.tax ?? 0)) },
            ...(Number(cart?.couponDiscount) > 0 ? [{ label: "Discount", value: `-${fmtZAR(Number(cart?.couponDiscount))}` }] : []),
          ].map((r, i) => (
            <div key={i} className="flex justify-between text-sm">
              <span className="text-gray-500">{r.label}</span>
              <span className={`font-semibold ${r.label === "Discount" || r.label === "BallylifeMORE saving" ? "text-green-700" : "text-gray-900"}`}>{r.value}</span>
            </div>
          ))}
          <div className="border-t border-gray-100 pt-3 flex justify-between">
            <span className="font-bold text-gray-900">Total</span>
            <span className="text-xl font-black" style={{ color: "#8A6420" }}>{fmtZAR(Number(cart?.total ?? 0))}</span>
          </div>
          <ChargedInZarNote zarTotal={Number(cart?.total ?? 0)} />
        </div>
        <button onClick={onCheckout}
          className="w-full py-3.5 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2"
          style={{ background: "linear-gradient(135deg,#D4A54A,#B8862E)" }}>
          Proceed to Checkout <ChevronRight className="w-4 h-4" />
        </button>
        <div className="flex items-center justify-center mt-4"><CardSchemeMarks /></div>
        <SecureCheckoutNote />
      </div>
    </div>
  );
}

// ─── CHECKOUT ─────────────────────────────────────────────────────────────────
function CheckoutView({ cart, addresses, userId, onBack, onComplete, onAddressAdded }: {
  cart: R | null; addresses: R[]; userId: string;
  onBack: () => void; onComplete: (order: R) => void; onAddressAdded: () => Promise<void>;
}) {
  const [step, setStep]     = useState<CheckoutStep>("address");
  const [paymentPending, setPaymentPending] = useState(false);
  const [selAddr, setSelAddr] = useState(0);
  const [shipping, setShipping] = useState("standard");
  // Store credit (business rebates, Ballylife.credit rewards) can pay part or all of the order.
  const [creditBalance, setCreditBalance] = useState(0);
  const [useCredit, setUseCredit] = useState(true);
  useEffect(() => {
    import("../services/marketplaceApi").then(({ mktProgrammes }) => mktProgrammes.storeCredit())
      .then(r => { if (r.success) setCreditBalance(r.data.balance); }).catch(() => undefined);
  }, []);
  const creditToApply = useCredit ? Math.min(creditBalance, Number(cart?.total ?? 0)) : 0;
  const amountDue = Math.max(0, Number(cart?.total ?? 0) - creditToApply);
  // Keep the last non-empty item list: the cart is emptied once the order is
  // placed, but the confirmation screen still needs to describe delivery.
  const checkoutItemsRef = useRef<R[]>([]);
  if (((cart?.items as R[]) ?? []).length) checkoutItemsRef.current = cart!.items as R[];
  const checkoutItems = checkoutItemsRef.current;
  const [payment, setPayment] = useState("");
  const [bnplProvider, setBnplProvider] = useState("");
  const [methods, setMethods] = useState<PaymentMethodsInfo | null>(null);
  const [methodsError, setMethodsError] = useState(false);
  const [placedOrder, setPlacedOrder] = useState<{ orderNumber: string; method: string } | null>(null);
  useEffect(() => {
    import("../services/marketplaceApi").then(({ mktPayments }) => mktPayments.methods())
      .then(r => {
        if (!r.success) { setMethodsError(true); return; }
        setMethods(r.data);
        setPayment(r.data.card.available ? "card" : r.data.eft.available ? "bank_transfer" : r.data.bnpl.available ? "bnpl" : "");
        setBnplProvider(r.data.bnpl.providers[0]?.key ?? "");
      })
      .catch(() => setMethodsError(true));
  }, []);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [addingAddress, setAddingAddress] = useState(addresses.length === 0);
  const [newAddr, setNewAddr] = useState({ label: "Home", firstName: "", lastName: "", line1: "", city: "", postalCode: "", phone: "" });
  const [savingAddr, setSavingAddr] = useState(false);
  const [addrError, setAddrError] = useState<string | null>(null);

  // addresses can still be loading (or arrive late) when this component
  // first mounts -- useState's lazy initializer above only runs once, so
  // if it started empty and real addresses show up shortly after, this
  // closes the auto-opened form once -- but only that first time, not
  // every render, or it would also fight the user manually reopening
  // "+ Add a new address" with existing addresses already loaded.
  const hasAutoClosedRef = useRef(false);
  useEffect(() => {
    if (addresses.length > 0 && !hasAutoClosedRef.current) {
      hasAutoClosedRef.current = true;
      setAddingAddress(false);
    }
  }, [addresses.length]);
  const STEPS: CheckoutStep[] = ["address","shipping","payment","confirmation"];
  const si = STEPS.indexOf(step);

  const handleSaveAddress = async () => {
    setAddrError(null);
    const { firstName, lastName, line1, city, postalCode, phone } = newAddr;
    if (!firstName || !lastName || !line1 || !city || !postalCode || !phone) {
      setAddrError("Please fill in every field.");
      return;
    }
    setSavingAddr(true);
    try {
      const res = await mktAddAddress(userId, newAddr) as { success: boolean; error?: string };
      if (!res.success) { setAddrError(res.error ?? "Couldn't save that address — please check the details and try again."); return; }
      await onAddressAdded();
      setAddingAddress(false);
      setNewAddr({ label: "Home", firstName: "", lastName: "", line1: "", city: "", postalCode: "", phone: "" });
    } catch (err) {
      setAddrError(err instanceof ApiConnectionError ? err.message : "Couldn't save that address — please try again.");
    } finally {
      setSavingAddr(false);
    }
  };

  const handlePlace = async () => {
    setPlacing(true);
    setPlaceError(null);
    try {
      const { mktOrders: api } = await import("../services/marketplaceApi");
      // Fully covered by store credit: nothing to collect, whatever's selected.
      const paymentMethod = amountDue === 0 && creditToApply > 0 ? "card" : payment === "bnpl" ? `bnpl_${bnplProvider}` : payment;
      const res = await api.place({ addressId: (addresses[selAddr] as R)?.id, shippingMethod: shipping, paymentMethod, useStoreCredit: creditToApply > 0 });
      if ((res as { success: boolean }).success) {
        // If PayFast (or any future redirect-based processor) is
        // configured, the order exists but payment isn't done yet — send
        // the browser to the gateway's own hosted page instead of
        // treating this as a completed order. A hidden auto-submitting
        // form is the standard way to hand off signed fields to PayFast;
        // it can't be a plain link since the fields (and signature) must
        // go via POST.
        const redirect = res.meta?.redirect;
        if (redirect) {
          const { submitToPayfast } = await import("../services/marketplaceApi");
          submitToPayfast(redirect.url, redirect.fields);
          return; // browser is navigating away — nothing left to do here
        }
        setPlacedOrder({ orderNumber: String((res.data as R)?.orderNumber ?? ""), method: paymentMethod });
        setStep("confirmation");
        // Honest reading of what the backend actually did: it only ever
        // auto-confirms a demo account's order (see marketplaceRouter.ts).
        // Every real account lands here with paymentStatus still
        // "pending_payment", genuinely unconfirmed -- the UI needs to say
        // that plainly rather than showing the same "Order Placed!" +
        // "Total paid" success screen regardless of whether anything was
        // actually paid.
        setPaymentPending(res.meta?.paymentStatus !== "payment_confirmed");
        onComplete(res.data as R);
      } else {
        setPlaceError((res as { error?: string }).error ?? "We couldn't place your order. Please check your details and try again.");
      }
    } catch {
      setPlaceError("Something went wrong placing your order. Please try again.");
    } finally { setPlacing(false); }
  };

  return (
    <div className="flex-1 overflow-y-auto p-5" style={{ background: "#FAF6EC" }}>
      {/* Stepper */}
      <div className="flex items-start gap-0 mb-6 max-w-lg mx-auto">
        {(["Address","Shipping","Payment"] as const).map((label, i) => (
          <div key={label} className="flex-1 flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all"
                style={{ background: si >= i ? "#B8862E" : "#E5E7EB", color: si >= i ? "white" : "#9CA3AF" }}>
                {si > i ? <CheckCircle className="w-4 h-4" /> : i + 1}
              </div>
              <span className="text-[10px] text-gray-500">{label}</span>
            </div>
            {i < 2 && <div className="flex-1 h-px mx-2 mt-3.5" style={{ background: si > i ? "#B8862E" : "#E5E7EB" }} />}
          </div>
        ))}
      </div>

      {step === "address" && (
        <div className="max-w-lg mx-auto space-y-4">
          <h2 className="font-serif text-lg text-gray-900" style={{ fontWeight: 600 }}>Delivery Address</h2>
          {addresses.map((a, i) => (
            <button key={i} onClick={() => { setSelAddr(i); setAddingAddress(false); }}
              className={`w-full p-4 rounded-2xl text-left border transition-all ${selAddr === i && !addingAddress ? "border-emerald-400 bg-emerald-50" : "border-gray-200 bg-white"}`}>
              <div className="flex items-start gap-3">
                <div className={`w-5 h-5 rounded-full border-2 mt-0.5 flex items-center justify-center flex-shrink-0 ${selAddr === i && !addingAddress ? "border-emerald-600 bg-emerald-600" : "border-gray-300"}`}>
                  {selAddr === i && !addingAddress && <div className="w-2 h-2 rounded-full bg-white" />}
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{a.label as string}</p>
                  <p className="text-xs text-gray-600">{a.firstName as string} {a.lastName as string}</p>
                  <p className="text-xs text-gray-500">{a.line1 as string}, {a.city as string} {a.postalCode as string}</p>
                </div>
              </div>
            </button>
          ))}

          {addresses.length > 0 && !addingAddress && (
            <button onClick={() => setAddingAddress(true)} className="w-full p-3 rounded-2xl border border-dashed border-gray-300 text-xs font-semibold text-gray-500 hover:border-[#B8862E] hover:text-[#8A6420]">
              + Add a new address
            </button>
          )}

          {addingAddress && (
            <div className="p-4 rounded-2xl border border-gray-200 bg-white space-y-2">
              <p className="text-sm font-semibold text-gray-900 mb-1">{addresses.length === 0 ? "Add your delivery address" : "New address"}</p>
              {addrError && <div className="px-3 py-2 rounded-lg bg-red-50 text-red-600 text-xs font-medium">{addrError}</div>}
              <div className="grid grid-cols-2 gap-2">
                <input placeholder="First name" value={newAddr.firstName} onChange={e => setNewAddr(p => ({ ...p, firstName: e.target.value }))}
                  className="border border-gray-200 rounded-lg px-2.5 py-2 text-sm outline-none focus:border-[#B8862E]" />
                <input placeholder="Last name" value={newAddr.lastName} onChange={e => setNewAddr(p => ({ ...p, lastName: e.target.value }))}
                  className="border border-gray-200 rounded-lg px-2.5 py-2 text-sm outline-none focus:border-[#B8862E]" />
              </div>
              <input placeholder="Street address" value={newAddr.line1} onChange={e => setNewAddr(p => ({ ...p, line1: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm outline-none focus:border-[#B8862E]" />
              <div className="grid grid-cols-2 gap-2">
                <input placeholder="City" value={newAddr.city} onChange={e => setNewAddr(p => ({ ...p, city: e.target.value }))}
                  className="border border-gray-200 rounded-lg px-2.5 py-2 text-sm outline-none focus:border-[#B8862E]" />
                <input placeholder="Postal code" value={newAddr.postalCode} onChange={e => setNewAddr(p => ({ ...p, postalCode: e.target.value }))}
                  className="border border-gray-200 rounded-lg px-2.5 py-2 text-sm outline-none focus:border-[#B8862E]" />
              </div>
              <input placeholder="Phone number" value={newAddr.phone} onChange={e => setNewAddr(p => ({ ...p, phone: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm outline-none focus:border-[#B8862E]" />
              <div className="flex gap-2 pt-1">
                {addresses.length > 0 && (
                  <button onClick={() => { setAddingAddress(false); setAddrError(null); }} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-gray-600 border border-gray-200">
                    Cancel
                  </button>
                )}
                <button onClick={handleSaveAddress} disabled={savingAddr} className="flex-[2] py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-60" style={{ background: "#14110D" }}>
                  {savingAddr ? "Saving..." : "Save address"}
                </button>
              </div>
            </div>
          )}

          <button onClick={() => setStep("shipping")} disabled={addresses.length === 0 || addingAddress}
            className="w-full py-3.5 rounded-2xl text-sm font-bold text-white disabled:opacity-50"
            style={{ background: "linear-gradient(135deg,#D4A54A,#B8862E)" }}>
            Continue to Shipping
          </button>
        </div>
      )}

      {step === "shipping" && (
        <div className="max-w-lg mx-auto space-y-3">
          <h2 className="font-serif text-lg text-gray-900" style={{ fontWeight: 600 }}>Delivery</h2>
          {/* One option, priced exactly as the server charges it. (Express and
              Click & Collect were shown here before but never existed on the
              server -- every order was charged standard delivery.) */}
          {[
            {
              id: "standard",
              label: checkoutItems.every(i => i.shippingIncluded) ? "Door-to-door delivery" : "Standard Delivery",
              sub: cartDeliveryWindow(checkoutItems),
              price: Number(cart?.shipping) > 0 ? fmtZAR(Number(cart?.shipping)) : checkoutItems.every(i => i.shippingIncluded) ? "INCLUDED" : "FREE",
            },
          ].map(opt => (
            <button key={opt.id} onClick={() => setShipping(opt.id)}
              className={`w-full p-4 rounded-2xl text-left border flex items-center gap-3 transition-all ${shipping === opt.id ? "border-emerald-400 bg-emerald-50" : "border-gray-200 bg-white"}`}>
              <Truck className="w-5 h-5 flex-shrink-0" style={{ color: "#8A6420" }} />
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-900">{opt.label}</p>
                <p className="text-xs text-gray-500">{opt.sub}</p>
              </div>
              <span className={`text-sm font-bold ${opt.price === "FREE" || opt.price === "INCLUDED" ? "text-green-600" : "text-gray-800"}`}>{opt.price}</span>
            </button>
          ))}
          <div className="flex gap-3 pt-2">
            <button onClick={() => setStep("address")} className="flex-1 py-3.5 rounded-2xl text-sm font-semibold border border-gray-200">Back</button>
            <button onClick={() => setStep("payment")} className="flex-[2] py-3.5 rounded-2xl text-sm font-bold text-white" style={{ background: "linear-gradient(135deg,#D4A54A,#B8862E)" }}>Continue to Payment</button>
          </div>
        </div>
      )}

      {step === "payment" && (
        <div className="max-w-lg mx-auto space-y-4">
          <h2 className="font-serif text-lg text-gray-900" style={{ fontWeight: 600 }}>Payment Method</h2>
          {!methods && !methodsError && (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-4"><Loader2 className="w-4 h-4 animate-spin" />Loading payment options…</div>
          )}
          {amountDue > 0 && methods && (() => {
            const options = [
              methods.card.available && { id: "card", label: "Card", sub: "Visa · Mastercard" },
              methods.eft.available && { id: "bank_transfer", label: "Bank transfer", sub: "EFT" },
              methods.bnpl.available && { id: "bnpl", label: "Pay later", sub: methods.bnpl.providers.map(pr => pr.name).join(" · ") },
            ].filter(Boolean) as { id: string; label: string; sub: string }[];
            if (options.length === 0) return (
              <div className="rounded-xl px-4 py-3 text-sm text-amber-800 bg-amber-50 border border-amber-100">
                Online payment is temporarily unavailable. Your cart is saved — please try again a little later.
              </div>
            );
            return (
              <div className={`grid gap-2 ${options.length === 1 ? "grid-cols-1" : options.length === 2 ? "grid-cols-2" : "grid-cols-3"}`} role="radiogroup" aria-label="Payment method">
                {options.map(opt => (
                  <button key={opt.id} onClick={() => setPayment(opt.id)} role="radio" aria-checked={payment === opt.id}
                    className={`flex flex-col items-start gap-0.5 p-3 rounded-2xl border text-left transition-all ${payment === opt.id ? "border-emerald-400 bg-emerald-50" : "border-gray-200 bg-white"}`}>
                    <span className="text-sm font-semibold text-gray-900">{opt.label}</span>
                    <span className="text-[10px] text-gray-500 leading-tight">{opt.sub}</span>
                  </button>
                ))}
              </div>
            );
          })()}
          {methodsError && (
            <div className="rounded-xl px-4 py-3 text-sm text-red-700 bg-red-50 border border-red-100">We couldn't load payment options — please refresh the page.</div>
          )}
          {amountDue > 0 && payment === "card" && methods?.card.available && <CardPaymentPanel sandbox={methods.card.sandbox} />}
          {amountDue > 0 && payment === "bank_transfer" && methods?.eft.details && (
            <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-3">
              <p className="text-sm font-semibold text-gray-900">Pay by bank transfer (EFT)</p>
              <EftDetailsTable details={methods.eft.details} />
              <p className="text-[11px] text-gray-500">Use your order number as the payment reference. We'll confirm your order once the money reflects in our account — usually 1–2 business days. Nothing ships until then.</p>
            </div>
          )}
          {amountDue > 0 && payment === "bnpl" && methods?.bnpl.available && (
            <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-4">
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-2">In partnership with</p>
                <div className="grid grid-cols-2 gap-2">
                  {(methods?.bnpl.providers ?? []).map(pr => ({ id: pr.key, label: pr.name, tagline: pr.key === "payjustnow" ? "Pay in 3, interest-free" : "Pay in 4, interest-free" })).map(p => (
                    <button key={p.id} onClick={() => setBnplProvider(p.id)}
                      className={`text-left p-3 rounded-xl border transition-all ${bnplProvider === p.id ? "border-emerald-400 bg-emerald-50" : "border-gray-200 bg-white"}`}>
                      <p className="text-sm font-bold text-gray-900">{p.label}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">{p.tagline}</p>
                    </button>
                  ))}
                </div>
              </div>

              {(() => {
                const total = amountDue;
                const installments = bnplProvider === "payjustnow" ? 3 : 4;
                const perInstalment = total / installments;
                const providerLabel = methods?.bnpl.providers.find(pr => pr.key === bnplProvider)?.name ?? "The provider";
                return (
                  <div>
                    <p className="text-xs font-semibold text-gray-600 mb-2">Your payment plan</p>
                    <div className="rounded-xl border border-gray-100 overflow-hidden">
                      {Array.from({ length: installments }).map((_, i) => (
                        <div key={i} className="flex items-center justify-between px-3.5 py-2.5 text-sm border-b border-gray-50 last:border-0">
                          <span className="text-gray-500">{i === 0 ? "Due today" : `Payment ${i + 1} of ${installments}`}</span>
                          <span className="font-bold text-gray-900">{fmtZAR(perInstalment)}</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-gray-500 mt-2">
                      No interest or fees when paid on time. {providerLabel} runs its own quick eligibility check and credit assessment once you place your order — approval isn't guaranteed.
                    </p>
                  </div>
                );
              })()}
            </div>
          )}
          <div className="bg-white rounded-2xl p-4 border border-gray-100">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Order total</span>
              <span className="font-black" style={{ color: "#8A6420" }}>{fmtZAR(Number(cart?.total ?? 0))}</span>
            </div>
            {creditToApply > 0 && (
              <div className="flex justify-between text-sm mt-1">
                <span className="text-gray-500">Store credit</span><span className="font-semibold text-green-700">-{fmtZAR(creditToApply)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm mt-1 pt-1 border-t border-gray-50">
              <span className="font-semibold text-gray-900">To pay now</span>
              <span className="font-black text-gray-900">{fmtZAR(amountDue)}</span>
            </div>
          </div>
          {placeError && (
            <div className="rounded-xl px-4 py-3 text-sm font-medium text-red-700 bg-red-50 border border-red-100">
              {placeError}
            </div>
          )}
          {creditBalance > 0 && (
            <label className="flex items-center gap-2.5 p-3 rounded-xl border border-emerald-200 bg-emerald-50 text-sm cursor-pointer">
              <input type="checkbox" checked={useCredit} onChange={e => setUseCredit(e.target.checked)} className="w-4 h-4" />
              <span className="flex-1">Use store credit <b>{fmtZAR(Math.min(creditBalance, Number(cart?.total ?? 0)))}</b> <span className="text-gray-600">(balance {fmtZAR(creditBalance)})</span></span>
            </label>
          )}
          <ChargedInZarNote zarTotal={amountDue} />
          <div className="flex gap-3">
            <button onClick={() => setStep("shipping")} className="flex-1 py-3.5 rounded-2xl text-sm font-semibold border border-gray-200">Back</button>
            <button onClick={handlePlace} disabled={placing || (amountDue > 0 && !payment)}
              className="flex-[2] py-3.5 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: "linear-gradient(135deg,#D4A54A,#B8862E)" }}>
              {placing ? <><Loader2 className="w-4 h-4 animate-spin" />Processing…</> : <>{amountDue === 0 && creditToApply > 0 ? "Pay with store credit" : payment === "card" ? "Continue to secure payment" : "Place Order"} · {fmtZAR(amountDue)}</>}
            </button>
          </div>
        </div>
      )}

      {step === "confirmation" && (
        <div className="max-w-lg mx-auto text-center py-10">
          {paymentPending ? (
            <>
              <div className="w-24 h-24 rounded-full mx-auto flex items-center justify-center mb-5 text-5xl" style={{ background: "#FFF8E8" }}>⏳</div>
              <h2 className="font-serif text-3xl text-gray-900 mb-2" style={{ fontWeight: 600 }}>Order Placed — Payment Pending</h2>
              <p className="text-gray-500 mb-6">{placedOrder?.method === "bank_transfer"
                ? "Your order is saved. Pay by bank transfer using the details below — we'll email you when the payment reflects. Nothing ships until then."
                : placedOrder?.method.startsWith("bnpl_")
                  ? "Your order is saved. Your pay-later provider will be in touch to complete their quick check — we'll email you once they approve it."
                  : "Your order is saved, but payment hasn't been confirmed yet. We'll email you as soon as it clears — nothing ships until then."}</p>
              {placedOrder?.method === "bank_transfer" && methods?.eft.details && (
                <div className="mb-4"><EftDetailsTable details={methods.eft.details} reference={placedOrder.orderNumber} /></div>
              )}
              <div className="bg-white rounded-2xl p-5 border border-gray-100 mb-6 space-y-2 text-left">
                {placedOrder?.orderNumber && <div className="flex justify-between text-sm"><span className="text-gray-500">Order number</span><span className="font-semibold">{placedOrder.orderNumber}</span></div>}
                <div className="flex justify-between text-sm"><span className="text-gray-500">Order total</span><span className="font-black" style={{ color: "#8A6420" }}>{fmtZAR(Number(cart?.total ?? 0))}</span></div>
                <div className="flex justify-between text-sm"><span className="text-gray-500">Payment status</span><span className="font-semibold text-amber-600">Pending confirmation</span></div>
                <div className="flex justify-between text-sm"><span className="text-gray-500">Estimated delivery</span><span className="font-semibold text-right">{cartDeliveryWindow(checkoutItems)} after payment clears</span></div>
              </div>
            </>
          ) : (
            <>
              <div className="w-24 h-24 rounded-full mx-auto flex items-center justify-center mb-5 text-5xl" style={{ background: "#F0FDF4" }}>✅</div>
              <h2 className="font-serif text-3xl text-gray-900 mb-2" style={{ fontWeight: 600 }}>Order Placed!</h2>
              <p className="text-gray-500 mb-6">Thank you! A confirmation email is on its way.</p>
              <div className="bg-white rounded-2xl p-5 border border-gray-100 mb-6 space-y-2 text-left">
                <div className="flex justify-between text-sm"><span className="text-gray-500">Total paid</span><span className="font-black" style={{ color: "#8A6420" }}>{fmtZAR(Number(cart?.total ?? 0))}</span></div>
                <div className="flex justify-between text-sm"><span className="text-gray-500">Estimated delivery</span><span className="font-semibold text-right">{cartDeliveryWindow(checkoutItems)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-gray-500">Tracking</span><span className="font-semibold text-right">Emailed and shown in My Orders once dispatched</span></div>
              </div>
            </>
          )}
          <button onClick={onBack} className="w-full py-3.5 rounded-2xl text-sm font-bold text-white" style={{ background: "linear-gradient(135deg,#D4A54A,#B8862E)" }}>Continue Shopping</button>
        </div>
      )}
    </div>
  );
}

// ─── ORDERS ───────────────────────────────────────────────────────────────────
function OrdersView() {
  const [orders, setOrders] = useState<R[]>([]);
  const [selected, setSelected] = useState<R | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const payOrder = async (order: R) => {
    setPaying(true);
    try {
      const { submitToPayfast } = await import("../services/marketplaceApi");
      const res = await mktOrders.pay(String(order.id));
      if (res.success && res.data?.redirect) { submitToPayfast(res.data.redirect.url, res.data.redirect.fields); return; }
      toast.error(res.error ?? "Couldn't start the payment — please try again.");
    } catch (err) {
      toast.error(err instanceof ApiConnectionError ? err.message : "Couldn't start the payment — please try again.");
    }
    setPaying(false);
  };

  useEffect(() => {
    mktOrders.list().then(r => { setOrders(r.data as R[]); setLoading(false); });
  }, []);

  if (loading) return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin" style={{ color: "#8A6420" }} /></div>;

  if (selected) return (
    <div className="flex-1 overflow-y-auto p-4" style={{ background: "#FAF6EC" }}>
      <button onClick={() => setSelected(null)} className="flex items-center gap-2 text-sm font-semibold mb-4" style={{ color: "#8A6420" }}>
        <ArrowLeft className="w-4 h-4" />Back to Orders
      </button>
      <div className="bg-white rounded-2xl border border-gray-100 p-5 max-w-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-900">{selected.orderNumber as string}</h2>
          <span className="text-xs px-3 py-1 rounded-full font-bold capitalize"
            style={{ background: (STATUS_COLOR[selected.status as string] ?? "#9CA3AF") + "20", color: STATUS_COLOR[selected.status as string] ?? "#9CA3AF" }}>
            {(selected.status as string).replace(/_/g, " ")}
          </span>
        </div>
        {(selected.items as R[]).map((item, i) => (
          <div key={i} className="flex items-center gap-3 py-3 border-b border-gray-50 last:border-0">
            <span className="relative w-10 h-10 flex items-center justify-center text-2xl rounded-lg overflow-hidden shrink-0">
              {item.emoji as string}
              {productPhotos([item.image])[0] && <ProductPhoto src={productPhotos([item.image])[0]} alt={item.productName as string} />}
            </span>
            <div className="flex-1"><p className="text-sm font-semibold text-gray-900">{item.productName as string}</p><p className="text-xs text-gray-500">Qty: {item.quantity as number}</p></div>
            <p className="text-sm font-bold text-gray-900">{fmtZAR(Number(item.totalPrice))}</p>
          </div>
        ))}
        <div className="space-y-1.5 border-t border-gray-100 pt-3">
          {[["Subtotal",selected.subtotal],["Shipping",selected.shippingCost],["Tax",selected.taxAmount],["Total",selected.totalAmount]].map(([l,v],i) => (
            <div key={i} className={`flex justify-between text-sm ${l==="Total"?"font-bold text-gray-900":"text-gray-500"}`}>
              <span>{l as string}</span><span>{fmtZAR(Number(v))}</span>
            </div>
          ))}
        </div>
        {selected.paymentStatus === "pending_payment" && selected.status === "pending" && selected.paymentMethod === "card" && (
          <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-100 space-y-2">
            <p className="text-xs font-semibold text-amber-800">This order is waiting for payment. It ships once your payment clears.</p>
            <button onClick={() => payOrder(selected)} disabled={paying}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-60" style={{ background: "#14110D" }}>
              {paying ? <Loader2 className="w-4 h-4 animate-spin" /> : null}Complete payment · {fmtZAR(Number(selected.totalAmount))}
            </button>
            <div className="flex justify-center"><CardSchemeMarks /></div>
          </div>
        )}
        {selected.trackingNumber && (
          <div className="flex items-center gap-3 p-3.5 rounded-xl bg-emerald-50">
            <Truck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <div>
              <p className="text-xs font-bold text-emerald-700">Tracking: {selected.trackingNumber as string}</p>
              <p className="text-xs text-emerald-600">{selected.carrier as string}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto p-4" style={{ background: "#FAF6EC" }}>
      <h2 className="font-serif text-xl text-gray-900 mb-4" style={{ fontWeight: 600 }}>My Orders</h2>
      {orders.length === 0 ? (
        <div className="text-center py-16 text-gray-500"><Package className="w-12 h-12 mx-auto mb-3 opacity-20" /><p className="font-semibold">No orders yet</p></div>
      ) : (
        <div className="space-y-3">
          {orders.map((o, i) => (
            <button key={i} onClick={() => setSelected(o)}
              className="w-full bg-white rounded-2xl border border-gray-100 p-4 hover:shadow-md hover:border-emerald-100 transition-all text-left">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-bold text-gray-900">{o.orderNumber as string}</p>
                <span className="text-xs px-2.5 py-1 rounded-full font-bold capitalize"
                  style={{ background: (STATUS_COLOR[o.status as string] ?? "#9CA3AF") + "20", color: STATUS_COLOR[o.status as string] ?? "#9CA3AF" }}>
                  {(o.status as string).replace(/_/g," ")}
                </span>
              </div>
              <div className="flex items-center gap-1.5 mb-2">
                {(o.items as R[]).slice(0, 3).map((it, j) => <span key={j} className="text-xl">{it.emoji as string}</span>)}
                {(o.items as R[]).length > 3 && <span className="text-xs text-gray-500">+{(o.items as R[]).length - 3}</span>}
              </div>
              {o.paymentStatus === "pending_payment" && o.status === "pending" && (
                <p className="text-[11px] font-semibold text-amber-700 mb-1.5">Awaiting payment</p>
              )}
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{new Date(o.placedAt as string).toLocaleDateString()}</span>
                <span className="font-bold text-gray-800">{fmtZAR(Number(o.totalAmount))}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── WISHLIST ─────────────────────────────────────────────────────────────────
function WishlistView({ authUser, wishlistIds, onProduct, onCart, onWishlist }: {
  authUser: { id: string }; wishlistIds: Set<string>; onProduct: (p: R) => void;
  onCart: (p: R) => void; onWishlist: (id: string) => void;
}) {
  const [items, setItems]   = useState<R[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { mktWishlist.get(authUser.id).then(r => { setItems(r.data as R[]); setLoading(false); }); }, [authUser.id]);
  if (loading) return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin" style={{ color: "#8A6420" }} /></div>;
  return (
    <div className="flex-1 overflow-y-auto p-4" style={{ background: "#FAF6EC" }}>
      <h2 className="font-serif text-xl text-gray-900 mb-4" style={{ fontWeight: 600 }}>My Wishlist ({items.length})</h2>
      {items.length === 0
        ? <div className="text-center py-16 text-gray-500"><Heart className="w-12 h-12 mx-auto mb-3 opacity-20" /><p className="font-semibold">No saved items</p></div>
        : <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {items.map((p, i) => (
              <ProductCard key={i} p={p} onView={() => onProduct(p)} onCart={() => onCart(p)}
                wishlistIds={wishlistIds} onWishlist={() => onWishlist(String(p.id))} />
            ))}
          </div>
      }
    </div>
  );
}


// ─── MAIN ─────────────────────────────────────────────────────────────────────
interface VinkMarketplaceProps { initialAction?: "sell" | "shop" | null; initialProductId?: string | null }

export function VinkMarketplace({ initialAction, initialProductId }: VinkMarketplaceProps) {
  const currency = useCurrency(); // subscribes this whole tree to live currency/rate updates
  const [locating, setLocating] = useState(false);
  const [locateFailed, setLocateFailed] = useState(false);
  const [countryMenuOpen, setCountryMenuOpen] = useState(false);
  const countryMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!countryMenuOpen) return;
    const close = (e: MouseEvent | TouchEvent) => { if (!countryMenuRef.current?.contains(e.target as Node)) setCountryMenuOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setCountryMenuOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("touchstart", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("touchstart", close); document.removeEventListener("keydown", esc); };
  }, [countryMenuOpen]);
  const handleUseLiveLocation = async () => {
    setLocating(true);
    setLocateFailed(false);
    const ok = await useLiveLocation();
    setLocating(false);
    if (!ok) setLocateFailed(true);
  };
  const [view, setView]           = useState<View>("home");
  const [categories, setCategories] = useState<R[]>([]);
  const [products, setProducts]   = useState<R[]>([]);
  const [cart, setCart]           = useState<R | null>(null);
  const [wishlistIds, setWishlistIds] = useState<Set<string>>(new Set());
  const [addresses, setAddresses] = useState<R[]>([]);
  const [selProductId, setSelProductId] = useState("");
  const navigate = useNavigate();
  const location = useLocation();

  // Bidirectional sync between `view`/`selProductId` and the real URL.
  // Each direction checks whether an update is actually needed before
  // acting, so the two effects below can't ping-pong off each other --
  // see routes.ts for why this "translate state to a URL" approach was
  // chosen over rewriting this component's rendering into <Route>
  // elements.
  useEffect(() => {
    const expectedPath = pathForView(view as MarketplaceView, selProductId);
    if (location.pathname !== expectedPath) navigate(expectedPath, { replace: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selProductId]);

  useEffect(() => {
    const { view: urlView, productId } = viewForPath(location.pathname);
    if (urlView !== view || (urlView === "product" && productId !== selProductId)) {
      setView(urlView as View);
      if (productId) setSelProductId(productId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // A short, distinct <title> per page -- otherwise every page (and
  // every search-result snippet or shared link preview) says the same
  // generic "Ballylife" regardless of what's actually being viewed.
  // The "product" view is deliberately excluded here -- ProductDetailView
  // sets a title+description from the real product's own name/description
  // once it loads, which is more useful than a generic one and would
  // otherwise get immediately overwritten by this effect anyway.
  useEffect(() => {
    if (view === "product") return;
    const suffix = TITLE_FOR_VIEW[view as MarketplaceView];
    setPageMeta(suffix ? `${suffix} — Ballylife` : "Ballylife");
  }, [view]);
  const [cartCount, setCartCount] = useState(0);
  const [authUser, setAuthUser]   = useState<MktAuthUser | null>(null);
  const [authSeller, setAuthSeller] = useState<{ id: string; storeName: string; status: string } | null>(null);
  const [authSupplier, setAuthSupplier] = useState<Record<string, unknown> | null>(null);
  const [authAuthority, setAuthAuthority] = useState<Record<string, unknown> | null>(null);
  const [authShipping, setAuthShipping] = useState<Record<string, unknown> | null>(null);
  const [authCredit, setAuthCredit] = useState<Record<string, unknown> | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalTab, setAuthModalTab] = useState<"signin" | "seller">(initialAction === "sell" ? "seller" : "signin");
  const [navSearch, setNavSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [navSuggests, setNavSuggests] = useState<R[]>([]);
  const [showSuggests, setShowSuggests] = useState(false);
  const navSearchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const MANAGER_ROLES = ["superadmin", "noc_engineer", "billing_admin", "marketplace_admin"];
  const role: "customer" | "seller" | "supplier" | "authority" | "shipping" | "credit" | "manager" | null =
    !authUser ? null : MANAGER_ROLES.includes(authUser.role) ? "manager" : authUser.role === "seller" ? "seller" : authUser.role === "supplier" ? "supplier" : authUser.role === "revenue_authority" ? "authority" : authUser.role === "shipping_company" ? "shipping" : authUser.role === "credit_provider" ? "credit" : "customer";

  useEffect(() => {
    // Marketplace is a fully independent account system now — its own
    // users table, its own JWT, no bridging with Vink's main app login.
    const restored = mktAuth.restoreSession();
    if (restored) { setAuthUser(restored.user); setAuthSeller(restored.seller); setAuthSupplier(restored.supplier); setAuthAuthority(restored.authority); setAuthShipping(restored.shipping); setAuthCredit(restored.credit); }
  }, []);

  useEffect(() => {
    if (initialAction === "sell" && !mktAuth.restoreSession()) setShowAuthModal(true);
  }, [initialAction]);

  useEffect(() => {
    if (initialProductId) { setSelProductId(initialProductId); setView("product"); }
    else if (initialAction === "shop") { setView("catalog"); }
  }, [initialAction, initialProductId]);

  const loadInitial = useCallback(async () => {
    const promises: Promise<unknown>[] = [mktCategories(), mktProducts.list({ sort: "popular", limit: "78" })];
    if (authUser) promises.push(mktCart.get(authUser.id), mktWishlist.get(authUser.id), mktAddresses(authUser.id));
    const results = await Promise.allSettled(promises);
    const [catRes, prodRes, cartRes, wishRes, addrRes] = results as PromiseSettledResult<{ data: unknown }>[];
    // Empty categories are hidden from shoppers -- a menu of empty aisles
    // makes the whole shop look empty.
    if (catRes.status  === "fulfilled") setCategories((catRes.value.data as R[]).filter(c => Number(c.productCount ?? 0) > 0));
    else showLoadError(catRes.reason);
    if (prodRes.status === "fulfilled") setProducts(prodRes.value.data as R[]);
    else showLoadError(prodRes.reason);
    if (authUser) {
      if (cartRes?.status === "fulfilled" && cartRes.value.data) setCart(cartRes.value.data as R);
      if (wishRes?.status === "fulfilled") setWishlistIds(new Set(((wishRes.value.data as R[]) ?? []).map(p => String(p.id))));
      if (addrRes?.status === "fulfilled") setAddresses((addrRes.value.data as R[]) ?? []);
    } else {
      setCart(null); setWishlistIds(new Set()); setAddresses([]);
    }
  }, [authUser]);

  useEffect(() => { loadInitial(); }, [loadInitial]);
  // Back from PayFast's payment page for an order.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("payfast");
    if (!result) return;
    const order = params.get("order") ?? "your order";
    if (result === "success") toast.success(`Payment submitted for ${order}. We'll confirm your order by email as soon as PayFast clears it.`);
    else toast(`Payment cancelled — ${order} is saved and you haven't been charged. You can pay any time from My Orders.`);
    setView("orders");
    params.delete("payfast"); params.delete("order");
    window.history.replaceState(null, "", window.location.pathname + (params.toString() ? `?${params}` : ""));
  }, []);
  // Back from PayFast's card authorisation for a BallylifeMORE subscription.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("subscription");
    if (!result) return;
    if (result === "success") { toast.success("Welcome to BallylifeMORE! Your membership activates as soon as PayFast confirms your card."); setView("account"); }
    else toast("Subscription not completed — you haven't been charged.");
    params.delete("subscription");
    window.history.replaceState(null, "", window.location.pathname + (params.toString() ? `?${params}` : ""));
  }, []);
  useEffect(() => { setCartCount(((cart?.items as R[]) ?? []).length); }, [cart]);

  const handleAddToCart = async (p: R, variantId?: string) => {
    if (!authUser) { setShowAuthModal(true); return; }
    try {
      const res = await mktCart.add(authUser.id, { productId: p.id, variantId: variantId ?? null, quantity: 1 });
      if (!res.success) {
        toast.error(res.error ?? "Couldn't add that to your cart.");
        // Quick-add from a card can't pick a colour/size -- take them to the product page to choose.
        if (res.code === "VARIANT_REQUIRED") { setSelProductId(String(p.id)); setView("product"); }
        return;
      }
      setCart(res.data as R);
    } catch (err) { showLoadError(err); }
  };

  const handleUpdateQty = async (productId: string, qty: number) => {
    if (!authUser) return;
    try {
      if (qty <= 0) { await mktCart.remove(authUser.id, productId); }
      else { await mktCart.update(authUser.id, productId, qty); }
      loadInitial();
    } catch (err) { showLoadError(err); }
  };

  const handleRemove = async (productId: string) => {
    if (!authUser) return;
    try {
      await mktCart.remove(authUser.id, productId);
      loadInitial();
    } catch (err) { showLoadError(err); }
  };

  const handleCoupon = async (code: string) => {
    if (!authUser) return;
    try {
      const res = await mktCart.coupon(authUser.id, code);
      if (res.data) setCart(res.data as R);
    } catch (err) { showLoadError(err); }
  };

  const handleWishlist = async (productId: string) => {
    if (!authUser) { setShowAuthModal(true); return; }
    if (wishlistIds.has(productId)) {
      await mktWishlist.remove(authUser.id, productId);
      setWishlistIds(prev => { const s = new Set(prev); s.delete(productId); return s; });
    } else {
      await mktWishlist.add(authUser.id, productId);
      setWishlistIds(prev => new Set([...prev, productId]));
    }
  };

  const handleAuthenticated = (user: MktAuthUser, seller: { id: string; storeName: string; status: string } | null, supplier?: Record<string, unknown> | null, authority?: Record<string, unknown> | null, shipping?: Record<string, unknown> | null, credit?: Record<string, unknown> | null) => {
    setAuthUser(user);
    setAuthSeller(seller);
    setAuthSupplier(supplier ?? null);
    setAuthAuthority(authority ?? null);
    setAuthShipping(shipping ?? null);
    setAuthCredit(credit ?? null);
    setShowAuthModal(false);
    const dest = MANAGER_ROLES.includes(user.role) ? "admin" : user.role === "seller" ? "seller" : user.role === "supplier" ? "supplier" : user.role === "revenue_authority" ? "authority" : user.role === "shipping_company" ? "shipping" : user.role === "credit_provider" ? "credit" : "account";
    setView(dest as View);
  };

  const handleSignOut = () => {
    mktAuth.logout();
    setAuthUser(null);
    setAuthSeller(null);
    setAuthSupplier(null);
    setAuthAuthority(null);
    setAuthShipping(null);
    setAuthCredit(null);
    setCart(null);
    setWishlistIds(new Set());
    setAddresses([]);
    setView("home");
  };

  // "Track Order", "Contact Us", "Platform Terms", "Human Rights
  // Statement", "Responsible Disclosure Policy", "Speak Up Process",
  // "Code of Advertising Practice", "Ballylife.credit Terms",
  // "Ballylife for Business Terms", "Privacy Policy", "Returns Policy"
  // and "BallylifeMORE Terms" are wired to actual destinations -- every
  // footer link in the "Terms and Policies" column now has a real
  // destination.
  // Every footer link now goes somewhere real. Where a dedicated page or
  // feature doesn't exist yet (careers, press, pickup points, etc.), it
  // routes to the closest genuinely-existing destination -- Contact Us as
  // the general catch-all for "get in touch about this" -- rather than a
  // dead link, and duplicate labels (e.g. "Returns" appears in both the
  // Account and Help columns) always resolve to the same destination.
  const handleFooterLink = (label: string) => {
    // Account
    if (label === "My Account" || label === "Invoices" || label === "Coupons" || label === "Personal Details") { gateOrPrompt("account"); return; }
    if (label === "Track Order") { setView("trackOrder"); return; }
    if (label === "Ballylife") { setView("morePlans"); return; }
    if (label === "Returns") { setView("returnsPolicyPage"); return; }

    // Help
    if (label === "Contact Us" || label === "Help Centre" || label === "Submit an Idea" || label === "Suggest a Product"
      || label === "Ballylife Pickup Points" || label === "Log Intellectual Property Complaint") { setView("contactPage"); return; }
    if (label === "Shipping & Delivery") { setView("termsPage"); return; }

    // Company
    if (label === "About Us" || label === "Press & News") { setView("aboutUsPage"); return; }
    if (label === "Careers" || label === "Deliver for Ballylife" || label === "Competitions") { setView("contactPage"); return; }
    if (label === "Sell on Ballylife") { setAuthModalTab("seller"); setShowAuthModal(true); return; }
    if (label === "Ballylife for Business") { setView("businessTermsPage"); return; }
    if (label === "Ballylife.credit") { setView("creditRewardsPage"); return; }

    // Terms and Policies
    if (label === "Platform Terms") { setView("termsPage"); return; }
    if (label === "Human Rights Statement") { setView("humanRightsPage"); return; }
    if (label === "Responsible Disclosure Policy") { setView("disclosurePage"); return; }
    if (label === "Speak Up Process") { setView("speakUpPage"); return; }
    if (label === "Code of Advertising Practice") { setView("advertisingPage"); return; }
    if (label === "Ballylife.credit Terms") { setView("creditRewardsPage"); return; }
    if (label === "Ballylife for Business Terms") { setView("businessTermsPage"); return; }
    if (label === "Privacy Policy") { setView("privacyPolicyPage"); return; }
    if (label === "Returns Policy") { setView("returnsPolicyPage"); return; }
    if (label === "BallylifeMORE Terms") { setView("ballylifeMorePage"); return; }

    // Shop, and the category strip -- no dedicated landing page exists per
    // deal type or per category yet (most of the 24 category names don't
    // correspond to a real seeded category), so these open the storefront
    // to browse rather than doing nothing.
    setView("catalog");
  };

  const gateOrPrompt = (dest: View) => {
    if (!authUser) { setShowAuthModal(true); return; }
    setView(dest);
  };

  const runSearch = (q: string) => {
    setSubmittedSearch(q);
    setShowSuggests(false);
    setView("catalog");
  };

  const onNavSearchChange = (v: string) => {
    setNavSearch(v);
    clearTimeout(navSearchTimer.current);
    if (v.trim().length < 2) { setNavSuggests([]); setShowSuggests(false); return; }
    navSearchTimer.current = setTimeout(async () => {
      const res = await mktProducts.suggest(v.trim());
      setNavSuggests((res.data as R[]) ?? []);
      setShowSuggests(true);
    }, 250);
  };

  const navItems = [
    { id:"seller" as View,   label:"Seller Central", icon:<TrendingUp className="w-4 h-4" />, roles:["seller"] },
    { id:"admin" as View,    label:"Manager Dashboard", icon:<Settings className="w-4 h-4" />, roles:["manager"] },
  ].filter(n => role && n.roles.includes(role));

  const CATEGORY_QUICK_LINKS = [...(categories as R[])].sort((a, b) => Number(b.productCount ?? 0) - Number(a.productCount ?? 0)).slice(0, 8);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#EAEDED]" style={{ fontFamily: "'Amazon Ember', Arial, sans-serif" }}>
      {/* ── Tier 1: dark top strip ── */}
      <header className="flex flex-wrap sm:flex-nowrap items-center gap-x-2 gap-y-2 sm:gap-4 px-3 sm:px-4 py-2 flex-shrink-0 z-20" style={{ background: "#1E7B4D" }}>
        <button
          onClick={() => { setView("home"); }}
          className="flex items-center px-2 py-1 rounded shrink-0 hover:opacity-90 transition-opacity"
        >
          <img src={ballylifeLogo} alt="Ballylife" className="h-10 sm:h-12 w-auto" />
        </button>

        <div className="relative shrink-0" ref={countryMenuRef}>
          {/* Detected country + currency, on every screen size. Tapping it
              (hover doesn't exist on phones) opens a small menu to confirm
              it, refine it with live location, or pick a country by hand. */}
          <button type="button" onClick={() => setCountryMenuOpen(o => !o)} aria-expanded={countryMenuOpen} aria-haspopup="dialog"
            className="flex flex-col items-start px-1.5 sm:px-2 py-1 rounded border border-transparent hover:border-white/40 text-white text-left">
            <span className="hidden sm:flex items-center gap-1 text-[10px] text-white/75 leading-none">
              <MapPin className="w-3 h-3" /> Deliver to
            </span>
            <span className="flex items-center gap-1 text-xs font-bold leading-tight sm:mt-0.5">
              <MapPin className="w-3 h-3 sm:hidden" />
              <span className="hidden md:inline">{currency.country.country ?? currency.country.countryCode}</span>
              <span className="md:hidden">{currency.country.countryCode}</span>
              <span className="text-white/80">· {currency.country.code}</span>
              <ChevronDown className="w-3 h-3" />
            </span>
          </button>
          {countryMenuOpen && (
            <div role="dialog" aria-label="Country and currency"
              className="absolute left-0 top-full mt-1 w-72 max-w-[calc(100vw-1.5rem)] bg-white rounded-lg shadow-2xl border border-gray-200 p-3 z-40 text-gray-800">
              <p className="text-[11px] text-gray-600 leading-relaxed mb-2">
                {currency.loading ? "Detecting your location…" : <>Showing prices in <b>{currency.country.name} ({currency.country.code})</b>{currency.country.code !== "ZAR" ? ", converted from South African rand at today's rate." : "."}</>}
              </p>
              <label className="block text-[11px] font-semibold text-gray-700 mb-1" htmlFor="country-select">Country / currency</label>
              <select id="country-select" value={currency.country.countryCode}
                onChange={e => { setCountryManually(e.target.value); setCountryMenuOpen(false); }}
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-xs mb-2 bg-white">
                {[...currency.countries].sort((a, b) => (a.country ?? a.countryCode).localeCompare(b.country ?? b.countryCode)).map(c => (
                  <option key={c.countryCode} value={c.countryCode}>{c.country ?? c.countryCode} · {c.code}</option>
                ))}
              </select>
              <button onClick={handleUseLiveLocation} disabled={locating}
                className="w-full text-left px-2.5 py-1.5 text-xs rounded-md hover:bg-gray-50 flex items-center gap-1.5 font-semibold disabled:opacity-50"
                style={{ color: "#8A6420", background: "#FBF3E1" }}>
                <MapPin className="w-3.5 h-3.5" /> {locating ? "Finding you…" : "Use my live location"}
              </button>
              {locateFailed && (
                <p className="pt-1.5 text-[10px] text-red-600">Couldn't get your location — check your browser's location permission and try again.</p>
              )}
              <p className="pt-2 text-[10px] text-gray-500 leading-snug">
                Orders are charged in South African rand (ZAR). {currency.ratesStale ? "Using the last known exchange rate. " : ""}
                <a href="https://www.exchangerate-api.com" target="_blank" rel="noopener noreferrer" className="underline">Rates by Exchange Rate API</a>
              </p>
            </div>
          )}
        </div>

        <div className="relative flex-1 flex items-stretch max-w-3xl h-10 sm:h-9 min-w-0 order-last basis-full sm:order-none sm:basis-auto">
          <div className="hidden sm:flex items-center bg-[#E8E8E8] hover:bg-[#DDD] px-2 text-[11px] text-gray-700 border-r border-gray-300 shrink-0 cursor-pointer relative group rounded-l">
            All <ChevronDown className="w-3 h-3 ml-1" />
            <div className="absolute top-full left-0 mt-0 w-56 bg-white text-gray-800 rounded-b shadow-2xl border border-gray-200 py-1 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-30">
              <div className="px-3 py-1.5 text-[10px] font-bold text-gray-500 uppercase tracking-wide">All Categories</div>
              <div className="relative group/new">
                <button onClick={() => setView("catalog")}
                  className="w-full flex items-center justify-between text-left px-3 py-1.5 text-xs font-bold border-b border-gray-100 mb-1 transition-colors hover:bg-[#FBF3E1]" style={{ color: "#8A6420" }}>
                  {DEPARTMENTS[0]} <ChevronRight className="w-3 h-3" />
                </button>
                <div className="absolute top-0 left-full ml-0.5 w-56 max-h-96 overflow-y-auto bg-white text-gray-800 rounded shadow-2xl border border-gray-200 py-1 opacity-0 invisible group-hover/new:opacity-100 group-hover/new:visible transition-all z-40">
                  {NEW_ARRIVALS_SUB.map((item) => (
                    <button key={item} onClick={() => setView("catalog")}
                      className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-[#FBF3E1] hover:text-[#8A6420] transition-colors">
                      {item}
                    </button>
                  ))}
                </div>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {DEPARTMENTS.slice(1).map((dept) => (
                  <button key={dept} onClick={() => setView("catalog")}
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-[#FBF3E1] hover:text-[#8A6420] transition-colors">
                    {dept}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <input
            value={navSearch}
            onChange={e => onNavSearchChange(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") runSearch(navSearch); if (e.key === "Escape") setShowSuggests(false); }}
            onFocus={() => { if (navSuggests.length) setShowSuggests(true); }}
            onBlur={() => setTimeout(() => setShowSuggests(false), 150)}
            placeholder="Search Ballylife"
            className="flex-1 min-w-0 bg-white sm:bg-white px-3 text-sm outline-none text-gray-800 rounded-l sm:rounded-l-none"
          />
          <button onClick={() => runSearch(navSearch)} className="w-11 flex items-center justify-center shrink-0 rounded-r" style={{ background: "#D4A54A" }}>
            <Search className="w-4 h-4 text-[#14110D]" />
          </button>

          {showSuggests && navSuggests.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded shadow-2xl border border-gray-200 overflow-hidden z-30">
              {navSuggests.map((s, i) => (
                <button
                  key={i}
                  onMouseDown={() => { setSelProductId(String(s.id)); setView("product"); setShowSuggests(false); setNavSearch(""); }}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 text-left"
                >
                  <span className="text-gray-700 truncate">{String(s.name)}</span>
                  <span className="text-gray-500 text-xs shrink-0 ml-2">{String(s.category)}</span>
                </button>
              ))}
              <button
                onMouseDown={() => runSearch(navSearch)}
                className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-left border-t border-gray-100"
                style={{ color: "#8A6420" }}
              >
                <Search className="w-3.5 h-3.5" /> See all results for "{navSearch}"
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-0.5 sm:gap-1 ml-auto shrink-0">
          <div className="relative group hidden md:block">
            <button onClick={() => { if (!authUser) setShowAuthModal(true); }} className="flex flex-col items-start px-2 py-1 rounded border border-transparent hover:border-white/40 text-white">
              <span className="text-[10px] text-white/70 leading-none flex items-center gap-1">
                <User className="w-3 h-3" /> Hello, {authUser ? authUser.name.split(" ")[0] : "sign in"}
              </span>
              <span className="text-xs font-bold leading-tight mt-0.5 flex items-center gap-0.5">
                Account &amp; Lists <ChevronDown className="w-3 h-3" />
              </span>
            </button>
            {authUser && (
              <div className="absolute right-0 top-full mt-0 w-56 bg-white rounded-b shadow-2xl border border-gray-200 py-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-30">
                <p className="px-3 pb-2 mb-1 border-b border-gray-100 text-[11px] text-gray-500">Signed in as {authUser.username} ({role})</p>
                {role === "customer" && (
                  <button onClick={() => setView("account")} className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 flex items-center gap-2 text-gray-700">
                    <User className="w-4 h-4" /> My Account
                  </button>
                )}
                {navItems.map(item => (
                  <button key={item.id} onClick={() => setView(item.id)} className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 flex items-center gap-2 text-gray-700">
                    {item.icon} {item.label}
                  </button>
                ))}
                <div className="border-t border-gray-100 mt-1 pt-1">
                  <button onClick={handleSignOut} className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 text-red-600">Sign out</button>
                </div>
              </div>
            )}
          </div>

          {role === "customer" && (
            <button onClick={() => gateOrPrompt("account")} className="hidden sm:flex flex-col items-start px-2 py-1 rounded border border-transparent hover:border-white/40 text-white">
              <span className="text-[10px] text-white/70 leading-none">Returns</span>
              <span className="text-xs font-bold leading-tight mt-0.5">&amp; Orders</span>
            </button>
          )}

          {role !== "seller" && role !== "manager" && (
            <button onClick={() => gateOrPrompt("wishlist")} className="relative p-2 rounded border border-transparent hover:border-white/40 text-white">
              <Heart className={`w-5 h-5 ${wishlistIds.size > 0 ? "fill-[#D4A54A] text-[#D4A54A]" : ""}`} />
              {wishlistIds.size > 0 && <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[#D4A54A] text-[#14110D] text-[9px] font-bold rounded-full flex items-center justify-center">{wishlistIds.size}</span>}
            </button>
          )}

          {role !== "seller" && role !== "manager" && (
            <button onClick={() => gateOrPrompt("cart")} className="relative flex items-end gap-1 px-2 py-1 rounded border border-transparent hover:border-white/40 text-white">
              <span className="relative">
                <ShoppingCart className="w-7 h-7" />
                <span className="absolute -top-1 left-3.5 text-[13px] font-black" style={{ color: "#D4A54A" }}>{cartCount}</span>
              </span>
              <span className="hidden lg:inline text-xs font-bold pb-1">Cart</span>
            </button>
          )}
        </div>
      </header>

      {/* ── Tier 2: category strip ── */}
      <div className="flex items-center gap-4 px-3 sm:px-4 py-1.5 flex-shrink-0 z-10 overflow-x-auto scrollbar-none" style={{ background: "#211C16" }}>
        <button onClick={() => setView("catalog")} className="flex items-center gap-1.5 text-white text-xs font-bold whitespace-nowrap hover:text-[#D4A54A] transition-colors">
          <Menu className="w-4 h-4" /> All
        </button>
        <button onClick={() => setView("home")} className="text-white/85 text-xs font-medium whitespace-nowrap hover:text-white transition-colors">Home</button>
        {CATEGORY_QUICK_LINKS.map((c, i) => (
          <button key={i} onClick={() => setView("catalog")} className="text-white/85 text-xs font-medium whitespace-nowrap hover:text-white transition-colors">
            {String(c.name)}
          </button>
        ))}
        {role !== "seller" && role !== "manager" && (
          <>
            <button onClick={() => setView("morePlans")} className="text-[#F5D48A] text-xs font-bold whitespace-nowrap hover:text-white transition-colors ml-auto">
              BallylifeMORE
            </button>
            <button onClick={() => setView("catalog")} className="text-white/85 text-xs font-medium whitespace-nowrap hover:text-white transition-colors ml-3">
              Today's Deals
            </button>
          </>
        )}
        {navItems.map(item => (
          <button key={item.id} onClick={() => setView(item.id)}
            className="hidden md:flex items-center gap-1 text-xs font-medium whitespace-nowrap transition-colors"
            style={{ color: view === item.id ? "#D4A54A" : "rgba(255,255,255,0.85)" }}>
            {item.icon} {item.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {view === "home" && (
            <HomeView
              categories={categories} products={products}
              onCategory={() => setView("catalog")}
              onProduct={p => { setSelProductId(String(p.id)); setView("product"); }}
              onCart={handleAddToCart}
              wishlistIds={wishlistIds} onWishlist={handleWishlist}
              onFooterLink={handleFooterLink}
            />
          )}
          {view === "catalog" && (
            <CatalogView
              categories={categories}
              onProduct={p => { setSelProductId(String(p.id)); setView("product"); }}
              onCart={handleAddToCart}
              wishlistIds={wishlistIds} onWishlist={handleWishlist}
              initialSearch={submittedSearch}
              onFooterLink={handleFooterLink}
            />
          )}
          {view === "product" && (
            <ProductDetailView
              productId={selProductId}
              onBack={() => setView("catalog")}
              onCart={(p, v) => { handleAddToCart(p, v); setView("cart"); }}
              wishlistIds={wishlistIds} onWishlist={handleWishlist}
              authUser={authUser} onRequireAuth={() => setShowAuthModal(true)}
              onFooterLink={handleFooterLink}
            />
          )}
          {view === "cart" && authUser && (
            <CartView
              cart={cart}
              onUpdateQty={handleUpdateQty}
              onRemove={handleRemove}
              onApplyCoupon={handleCoupon}
              onCheckout={() => setView("checkout")}
            />
          )}
          {view === "checkout" && authUser && (
            <CheckoutView
              cart={cart} addresses={addresses} userId={authUser.id}
              onBack={() => setView("home")}
              onAddressAdded={loadInitial}
              onComplete={() => { loadInitial(); setView("account"); }}
            />
          )}
          {view === "wishlist" && authUser && (
            <WishlistView
              authUser={authUser}
              wishlistIds={wishlistIds}
              onProduct={p => { setSelProductId(String(p.id)); setView("product"); }}
              onCart={handleAddToCart} onWishlist={handleWishlist}
            />
          )}
          {view === "account" && authUser && role === "customer" && (
            <CustomerDashboard user={authUser} onProduct={id => { setSelProductId(id); setView("product"); }} onSignOut={handleSignOut}
              onWishlist={() => setView("wishlist")}
              onContact={() => handleFooterLink("Contact Us")}
              onBallylifeMore={() => setView("morePlans")}
            />
          )}
          {view === "seller" && authUser && authSeller && role === "seller" && (
            <SellerDashboard user={authUser} seller={authSeller} onSignOut={handleSignOut} />
          )}
          {view === "supplier" && authUser && authSupplier && role === "supplier" && (
            <SupplierDashboard user={authUser} supplier={authSupplier} onSignOut={handleSignOut} />
          )}
          {view === "authority" && authUser && authAuthority && role === "authority" && (
            <AuthorityDashboard user={authUser} authority={authAuthority} onSignOut={handleSignOut} />
          )}
          {view === "shipping" && authUser && authShipping && role === "shipping" && (
            <ShippingCompanyDashboard user={authUser} shipping={authShipping} onSignOut={handleSignOut} />
          )}
          {view === "credit" && authUser && authCredit && role === "credit" && (
            <CreditProviderDashboard user={authUser} credit={authCredit} onSignOut={handleSignOut} />
          )}
          {view === "trackOrder" && (
            <OrderTracking onBack={() => setView("home")} />
          )}
          {(view === "contactPage" || view === "termsPage" || view === "humanRightsPage" || view === "disclosurePage" || view === "speakUpPage" || view === "advertisingPage" || view === "creditRewardsPage" || view === "businessTermsPage" || view === "privacyPolicyPage" || view === "returnsPolicyPage" || view === "ballylifeMorePage" || view === "aboutUsPage") && (
            <Suspense fallback={<div className="flex-1 flex items-center justify-center text-sm text-gray-500">Loading...</div>}>
              {view === "contactPage" && <ContactPage onBack={() => setView("home")} />}
              {view === "termsPage" && <TermsPage onBack={() => setView("home")} />}
              {view === "humanRightsPage" && <HumanRightsPage onBack={() => setView("home")} />}
              {view === "disclosurePage" && <DisclosurePage onBack={() => setView("home")} />}
              {view === "speakUpPage" && <SpeakUpPage onBack={() => setView("home")} />}
              {view === "advertisingPage" && <AdvertisingPage onBack={() => setView("home")} />}
              {view === "creditRewardsPage" && <CreditRewardsPage onBack={() => setView("home")} />}
              {view === "businessTermsPage" && <BusinessTermsPage onBack={() => setView("home")} />}
              {view === "privacyPolicyPage" && <PrivacyPolicyPage onBack={() => setView("home")} />}
              {view === "returnsPolicyPage" && <ReturnsPolicyPage onBack={() => setView("home")} />}
              {view === "ballylifeMorePage" && <BallylifeMorePage onBack={() => setView("home")} />}
              {view === "aboutUsPage" && <AboutUsPage onBack={() => setView("home")} onContact={() => setView("contactPage")} />}
            </Suspense>
          )}
          {view === "morePlans" && (
            <MorePlansPage loggedIn={Boolean(authUser)} onSignIn={() => setShowAuthModal(true)}
              onManage={() => setView("account")} onTerms={() => setView("ballylifeMorePage")} />
          )}
          {view === "admin" && authUser && role === "manager" && (
            <><DefaultPasswordBanner user={authUser} /><ManagerDashboard user={authUser} onSignOut={handleSignOut} /></>
          )}
      </div>

      {showAuthModal && <MarketplaceAuthModal onClose={() => setShowAuthModal(false)} onAuthenticated={handleAuthenticated} initialTab={authModalTab} />}
    </div>
  );
}
