import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import ballylifeLogo from "../imports/ballylife-logo-compact.png";
import {
  Search, ShoppingCart, Heart, Star, ChevronRight, ArrowLeft,
  SlidersHorizontal, Grid, List, Plus, Minus, Trash2,
  Package, Truck, CheckCircle, Tag, TrendingUp, BarChart3,
  Settings, Menu, Clock, Shield, Zap, RotateCcw, Loader2,
  Home, Filter, MapPin, ChevronDown, User, LogOut,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import {
  mktCategories, mktProducts, mktCart, mktOrders,
  mktWishlist, mktSellers, mktAdmin, mktAddresses, mktAuth, setMktToken, getMktToken, type MktAuthUser,
} from "../services/marketplaceApi";
import { isDemoMode } from "../services/demoMode";
import {
  ExecutiveChairIllustration, MeshTaskChairIllustration, ManagerChairIllustration,
  ConferenceChairIllustration, DraftingStoolIllustration, VisitorChairIllustration,
  GamingChairIllustration,
} from "./ChairIllustrations";

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
import { MarketplaceAuthModal } from "./MarketplaceAuthModal";
import { CustomerDashboard } from "./CustomerDashboard";
import { SellerDashboard } from "./SellerDashboard";
import { ManagerDashboard } from "./ManagerDashboard";
import { Product3DViewer } from "./Product3DViewer";
import { Footer } from "./Footer";
import { formatZAR, useCurrency, setCountryManually } from "../services/currencyStore";

// ─── Types ────────────────────────────────────────────────────────────────────
type View = "home" | "catalog" | "product" | "cart" | "checkout" | "orders" | "wishlist" | "seller" | "admin" | "account";
type CheckoutStep = "address" | "shipping" | "payment" | "confirmation";
type R = Record<string, unknown>;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtZAR = formatZAR; // now converts + formats in the shopper's local currency
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
function useAutoSlide<T extends HTMLElement>(itemCount: number, speed = 0.5) {
  const ref = useRef<T>(null);
  const paused = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || itemCount < 2) return;
    let raf: number;
    const tick = () => {
      if (!paused.current && el) {
        const max = el.scrollWidth - el.clientWidth;
        if (max > 0) {
          el.scrollLeft = el.scrollLeft >= max - 1 ? 0 : el.scrollLeft + speed;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [itemCount, speed]);

  const handlers = {
    onMouseEnter: () => { paused.current = true; },
    onMouseLeave: () => { paused.current = false; },
    onTouchStart: () => { paused.current = true; },
    onTouchEnd:   () => { paused.current = false; },
  };

  return { ref, handlers };
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
    <div className="bg-white rounded-2xl overflow-hidden border border-gray-100 hover:shadow-xl hover:-translate-y-0.5 hover:border-[#D4A54A]/40 transition-all duration-200 group" style={{ boxShadow: "0 1px 3px rgba(20,17,13,0.06)" }}>
      {/* Image */}
      <div className="relative cursor-pointer" style={{ height: 180 }} onClick={onView}>
        <div className="w-full h-full flex items-center justify-center text-7xl"
          style={{ background: `linear-gradient(135deg,${imgs?.[0] ?? "#F3F4F6"},${imgs?.[1] ?? "#E5E7EB"})` }}>
          {PRODUCT_ILLUSTRATIONS[p.id as string]
            ? <div className="w-24 h-24">{PRODUCT_ILLUSTRATIONS[p.id as string]()}</div>
            : (p.emoji as string)}
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
        <button onClick={e => { e.stopPropagation(); onWishlist(); }}
          className="absolute top-2 right-2 w-8 h-8 bg-white rounded-full shadow flex items-center justify-center hover:scale-110 transition-transform">
          <Heart className={`w-4 h-4 ${inWishlist ? "fill-red-500 text-red-500" : "text-gray-300"}`} />
        </button>
      </div>

      <div className="p-3 cursor-pointer" onClick={onView}>
        <p className="text-[10px] text-gray-400 mb-0.5">{p.brand as string}</p>
        <p className="text-sm font-semibold text-gray-900 leading-tight line-clamp-2 mb-1">{p.name as string}</p>
        <div className="flex items-center gap-1 mb-2">
          <Stars rating={Number(p.avgRating)} size={11} />
          <span className="text-[10px] text-gray-400">({Number(p.reviewCount).toLocaleString()})</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-base font-black text-gray-900">{fmtZAR(Number(p.price))}</span>
          {p.compareAtPrice && (
            <span className="text-xs text-gray-400 line-through">{fmtZAR(Number(p.compareAtPrice))}</span>
          )}
        </div>
        {Number(p.stock) > 0 && Number(p.stock) < 10 && (
          <p className="text-[10px] text-orange-500 font-semibold mt-0.5">Only {p.stock as number} left</p>
        )}
      </div>

      <div className="px-3 pb-3">
        <button onClick={e => { e.stopPropagation(); onCart(); }}
          className="w-full py-2 rounded-xl text-xs font-bold text-white flex items-center justify-center gap-1.5 transition-opacity hover:opacity-90"
          style={{ background: "linear-gradient(135deg,#D4A54A,#B8862E)" }}>
          <ShoppingCart className="w-3.5 h-3.5" />Add to Cart
        </button>
      </div>
    </div>
  );
}

// ─── HOME ──────────────────────────────────────────────────────────────────────
// ─── Home: static product rows ────────────────────────────────────────────────
const DEPARTMENTS = [
  "Electronics & DJI", "Baby & Toddler", "Books & Comics", "Camping & Outdoor",
  "Cellphones & Smartphones", "DIY", "Fashion & Luggage", "Computers & Electronics",
  "Drinks", "Garden, Pool & Patio", "Groceries & Household", "Health & Personal Care",
  "Home & Appliances", "Liquor", "Office & Stationery", "Pet", "Sport & Training",
  "Toys", "TV Audio & Media",
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
    <div className="bg-white border border-gray-200 flex flex-col cursor-pointer hover:shadow-md transition-shadow min-w-[150px] max-w-[190px] flex-shrink-0">
      <div className="relative" onClick={onView}>
        <div className="w-full flex items-center justify-center text-5xl py-4"
          style={{ background: `linear-gradient(135deg,${imgs?.[0] ?? "#f5f5f5"},${imgs?.[1] ?? "#e8e8e8"})`, minHeight: 100 }}>
          {PRODUCT_ILLUSTRATIONS[p.id as string]
            ? <div className="w-16 h-16">{PRODUCT_ILLUSTRATIONS[p.id as string]()}</div>
            : (p.emoji as string)}
        </div>
        {discount > 0 && (
          <div className="absolute top-1 left-1 bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5">-{discount}%</div>
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
          <span className="text-[9px] text-gray-400 ml-0.5">({p.reviewCount as number ?? 0})</span>
        </div>
        <div className="mt-auto">
          {p.compareAtPrice && (
            <p className="text-[10px] text-gray-400 line-through">{fmtZAR(Number(p.compareAtPrice))}</p>
          )}
          <p className="text-sm font-bold text-gray-900 mb-2">{fmtZAR(Number(p.price))}</p>
          <button onClick={e => { e.stopPropagation(); onCart(); }}
            className="w-full text-xs font-semibold py-1.5 border-2 transition-colors hover:bg-emerald-600 hover:text-white hover:border-emerald-600"
            style={{ borderColor: "#B8862E", color: "#B8862E" }}>
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
  const { ref, handlers } = useAutoSlide<HTMLDivElement>(items.length);
  if (!items.length) return null;
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between px-3 py-2 bg-white border-b border-gray-200">
        <span className="font-serif text-base text-gray-900" style={{ fontWeight: 600 }}>{title}</span>
        <button className="text-xs font-semibold" style={{ color: "#B8862E" }}>View more</button>
      </div>
      <div ref={ref} {...handlers} className="flex gap-0 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {items.map((p, i) => (
          <HomeProductCard key={i} p={p}
            onView={() => onProduct(p)}
            onCart={() => onCart(p)} />
        ))}
      </div>
    </div>
  );
}

function HeroProductSlider({ products, onView, onCart }: { products: R[]; onView: (p: R) => void; onCart: (p: R) => void }) {
  const [index, setIndex] = useState(0);
  const items = products.slice(0, 6);

  useEffect(() => {
    if (items.length < 2) return;
    const id = setInterval(() => setIndex(i => (i + 1) % items.length), 4000);
    return () => clearInterval(id);
  }, [items.length]);

  if (items.length === 0) return null;
  const p = items[index];
  const discount = p.compareAtPrice
    ? Math.round((1 - Number(p.price) / Number(p.compareAtPrice)) * 100) : 0;
  const imgs = p.images as string[];
  const go = (i: number) => setIndex((i + items.length) % items.length);

  return (
    <div className="flex-1 relative overflow-hidden rounded-sm min-h-[140px]"
      style={{ background: "linear-gradient(135deg,#FBF3E1 0%,#F3EBD8 100%)", border: "1px solid #E8D9B5" }}>
      <div className="absolute top-2 left-3 z-10 text-[10px] font-bold uppercase tracking-wider text-emerald-700">Featured today</div>

      {items.length > 1 && (
        <>
          <button
            onClick={() => go(index - 1)}
            className="absolute left-1.5 top-1/2 -translate-y-1/2 z-10 w-6 h-6 rounded-full bg-white/80 hover:bg-white flex items-center justify-center shadow-sm transition-colors"
            aria-label="Previous product"
          >
            <ChevronRight className="w-3.5 h-3.5 rotate-180 text-emerald-700" />
          </button>
          <button
            onClick={() => go(index + 1)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 z-10 w-6 h-6 rounded-full bg-white/80 hover:bg-white flex items-center justify-center shadow-sm transition-colors"
            aria-label="Next product"
          >
            <ChevronRight className="w-3.5 h-3.5 text-emerald-700" />
          </button>
        </>
      )}

      <div className="relative h-full flex items-center justify-between gap-3 px-8 py-4 min-h-[140px] cursor-pointer" onClick={() => onView(p)}>
        <div className="min-w-0 flex-1">
          {discount > 0 && (
            <span className="inline-block bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-sm mb-1.5">-{discount}% OFF</span>
          )}
          <p className="text-sm font-bold text-gray-900 leading-snug line-clamp-2 mb-1.5">{p.name as string}</p>
          <div className="flex items-baseline gap-1.5">
            {p.compareAtPrice && (
              <span className="text-[11px] text-gray-400 line-through">{fmtZAR(Number(p.compareAtPrice))}</span>
            )}
            <span className="text-lg font-black" style={{ color: "#B8862E" }}>{fmtZAR(Number(p.price))}</span>
          </div>
          <button
            onClick={e => { e.stopPropagation(); onCart(p); }}
            className="mt-2 bg-emerald-600 text-white text-xs font-bold px-4 py-1.5 rounded hover:bg-emerald-700 transition-colors"
          >
            Add to cart
          </button>
        </div>
        <div
          className="shrink-0 w-20 h-20 sm:w-24 sm:h-24 rounded-full flex items-center justify-center text-4xl sm:text-5xl shadow-sm overflow-hidden"
          style={{ background: `linear-gradient(135deg,${imgs?.[0] ?? "#fff"},${imgs?.[1] ?? "#e8e8e8"})` }}
        >
          {PRODUCT_ILLUSTRATIONS[p.id as string]
            ? <div className="w-14 h-14 sm:w-16 sm:h-16">{PRODUCT_ILLUSTRATIONS[p.id as string]()}</div>
            : (p.emoji as string)}
        </div>
      </div>

      {items.length > 1 && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
          {items.map((_, i) => (
            <button
              key={i}
              onClick={() => go(i)}
              className="h-1.5 rounded-full transition-all"
              style={{ width: index === i ? 16 : 6, background: index === i ? "#B8862E" : "rgba(18,138,67,0.3)" }}
              aria-label={`Product ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HomeView({ categories, products, onCategory, onProduct, onCart, wishlistIds, onWishlist }: {
  categories: R[]; products: R[];
  onCategory: () => void; onProduct: (p: R) => void;
  onCart: (p: R) => void; wishlistIds: Set<string>; onWishlist: (id: string) => void;
}) {
  const [activeCatStrip, setActiveCatStrip] = useState(0);
  const flashDeals = products.filter(p => p.isFlashDeal);
  const featured   = products.filter(p => p.isFeatured);
  // Rotate the full product pool per row (instead of thin fixed slices) so every
  // row has many items to auto-slide through, even with a modest catalogue size.
  const rotate = (arr: R[], n: number) => arr.length ? [...arr.slice(n % arr.length), ...arr.slice(0, n % arr.length)] : arr;
  const row1 = rotate(products, 0);    // deals of the day
  const row2 = rotate(products, 3);    // groceries & household
  const row3 = rotate([...products].reverse(), 1); // clearance men
  const row4 = rotate(products, 6);    // phones
  const rowHL = products.slice(1, 4);  // highlighted (red band)
  const row5 = rotate(products, 9);    // branded microwaves
  const dealsSlide = useAutoSlide<HTMLDivElement>(row1.length || 3);
  const phonesSlide = useAutoSlide<HTMLDivElement>((row4.length ? row4 : products.slice(2, 6)).length);
  const flashSlide = useAutoSlide<HTMLDivElement>(flashDeals.length);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-gray-100">

      {/* ── Hero ── */}
      <div className="flex-shrink-0 relative overflow-hidden" style={{ background: "linear-gradient(120deg,#14110D 0%,#211C16 55%,#14110D 100%)" }}>
        <div className="absolute inset-0 opacity-[0.06]" style={{
          backgroundImage: "radial-gradient(circle at 20% 30%, #D4A54A 0, transparent 45%), radial-gradient(circle at 80% 70%, #D4A54A 0, transparent 40%)"
        }} />
        <div className="relative px-5 sm:px-10 py-7 sm:py-9 flex items-center justify-between gap-6">
          <div>
            <p className="text-[10px] sm:text-xs tracking-[0.18em] font-semibold mb-2" style={{ color: "#D4A54A" }}>
              LIVE BOLD &nbsp;•&nbsp; LIVE WELL &nbsp;•&nbsp; LIVE BALLYLIFE
            </p>
            <h1 className="font-serif text-2xl sm:text-4xl text-white leading-tight" style={{ fontWeight: 600 }}>
              Everything you want,<br className="hidden sm:block" /> nothing you don't.
            </h1>
          </div>
          <button onClick={onCategory} className="hidden sm:inline-flex items-center gap-2 px-6 py-3 rounded-full text-sm font-bold shrink-0 transition-transform hover:scale-[1.03]"
            style={{ background: "linear-gradient(135deg,#D4A54A,#B8862E)", color: "#14110D" }}>
            Shop the full catalog
          </button>
        </div>
      </div>

      {/* ── Category tab strip ── */}
      <div className="bg-white border-b border-gray-200 flex items-center overflow-x-auto flex-shrink-0 px-2" style={{ scrollbarWidth: "none" }}>
        {CAT_STRIP_LABELS.map((label, i) => (
          <button key={i} onClick={() => { setActiveCatStrip(i); onCategory(); }}
            className="px-3 py-2.5 text-xs font-medium flex-shrink-0 transition-colors border-b-2"
            style={{
              borderBottomColor: activeCatStrip === i ? "#B8862E" : "transparent",
              color: activeCatStrip === i ? "#B8862E" : "#333",
            }}>
            {label}
          </button>
        ))}
        <button className="px-3 py-2.5 text-xs text-gray-400 flex-shrink-0">Clearance</button>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── Departments sidebar ── */}
        <aside className="hidden md:flex flex-col w-44 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto">
          <div className="px-3 py-2 text-[11px] font-bold text-gray-500 uppercase tracking-wide border-b border-gray-100">Departments</div>
          {DEPARTMENTS.map((dept) => (
            <button key={dept} onClick={onCategory}
              className="w-full text-left px-3 py-2 text-[11px] text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition-colors border-b border-gray-50 leading-snug">
              {dept}
            </button>
          ))}
        </aside>

        {/* ── Main content ── */}
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>

          {/* Hero banner */}
          <div className="flex gap-1 m-2">
            {/* Left — sliding featured products */}
            <HeroProductSlider
              products={featured.length ? featured : products}
              onView={onProduct}
              onCart={onCart}
            />
            {/* Right — 40% off + delivery check */}
            <div className="flex flex-col gap-1 w-48 flex-shrink-0">
              <div className="flex-1 rounded-sm p-3 flex flex-col justify-between"
                style={{ background: "linear-gradient(135deg,#fff7e6,#ffecc0)", border: "1px solid #fdd88a" }}>
                <div className="text-[10px] font-bold text-orange-600 uppercase">Selected items</div>
                <div className="text-4xl font-black leading-none" style={{ color: "#E65C00" }}>40%</div>
                <button onClick={onCategory} className="self-start bg-orange-500 text-white text-[10px] font-bold px-3 py-1 rounded hover:bg-orange-600 transition-colors mt-1">
                  Shop Now
                </button>
              </div>
              <div className="rounded-sm p-3 bg-white border border-gray-200">
                <div className="text-[10px] font-semibold text-gray-700 mb-1">Check your delivery or collection status</div>
                <div className="flex gap-1">
                  <input className="flex-1 text-[10px] border border-gray-300 rounded px-2 py-1 outline-none" placeholder="Order #" />
                  <button className="bg-emerald-600 text-white text-[10px] px-2 py-1 rounded hover:bg-emerald-700">Go</button>
                </div>
              </div>
            </div>
          </div>

          {/* Deals of the day */}
          <div className="mx-2 mb-2">
            <div className="flex items-center justify-between px-3 py-2 bg-white border-b border-gray-200">
              <span className="text-sm font-bold text-gray-900">Deals of the day</span>
              <button onClick={onCategory} className="text-xs font-semibold" style={{ color: "#B8862E" }}>View more</button>
            </div>
            <div ref={dealsSlide.ref} {...dealsSlide.handlers} className="flex gap-0 bg-white overflow-x-auto" style={{ scrollbarWidth: "none" }}>
              {row1.map((p, i) => (
                <HomeProductCard key={i} p={p} onView={() => onProduct(p)} onCart={() => onCart(p)} />
              ))}
              {row1.length === 0 && (
                <div className="flex gap-0">
                  {[
                    { name: "Samsung 1000 ssh 2048 SSD & USB Charging Power 150V", price: "R509", was: "R1,295", stars: 4, emoji: "📺" },
                    { name: "Melitta Q/100 Gas Grill Grey", price: "R4,039", was: "R4,099", stars: 4, emoji: "🔥" },
                    { name: "Energizer Vision Rechargeable 6V Torch 280lm", price: "R879", was: null, stars: 3, emoji: "🔦" },
                  ].map((item, i) => (
                    <div key={i} className="bg-white border border-gray-200 flex flex-col cursor-pointer hover:shadow-md transition-shadow min-w-[150px] max-w-[190px] flex-shrink-0">
                      <div className="w-full flex items-center justify-center text-5xl py-4 bg-gray-50 min-h-[100px]">{item.emoji}</div>
                      <div className="p-2 flex flex-col flex-1">
                        <p className="text-[11px] text-gray-700 leading-snug mb-1">{item.name}</p>
                        <div className="flex items-center gap-0.5 mb-1">
                          {[1,2,3,4,5].map(s => <svg key={s} width={9} height={9} viewBox="0 0 24 24" fill={s<=item.stars?"#FBBF24":"#E5E7EB"}><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>)}
                        </div>
                        <div className="mt-auto">
                          {item.was && <p className="text-[10px] text-gray-400 line-through">{item.was}</p>}
                          <p className="text-sm font-bold text-gray-900 mb-2">{item.price}</p>
                          <button onClick={onCategory} className="w-full text-xs font-semibold py-1.5 border-2 hover:bg-emerald-600 hover:text-white hover:border-emerald-600 transition-colors" style={{ borderColor: "#B8862E", color: "#B8862E" }}>Add to cart</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* No petrol strip */}
          <div className="mx-2 mb-2 bg-emerald-700 text-white flex items-center justify-between px-4 py-3 rounded-sm">
            <div>
              <p className="text-sm font-bold">No petrol needed — get it delivered</p>
              <p className="text-xs opacity-80">Free delivery on orders over R500 · Same-day available in major cities</p>
            </div>
            <button onClick={onCategory} className="text-xs font-bold bg-white text-emerald-700 px-4 py-1.5 rounded hover:bg-emerald-50 transition-colors flex-shrink-0 ml-4">
              View more
            </button>
          </div>

          {/* Product row sections */}
          <div className="mx-2">
            <ProductRow title="Groceries & household" products={row2.length ? row2 : products.slice(0,4)} onProduct={onProduct} onCart={onCart} slice={[0, 12]} />
            <ProductRow title="Shop ClarisMen" products={row3.length ? row3 : products.slice(1,5)} onProduct={onProduct} onCart={onCart} slice={[0, 12]} />
          </div>

          {/* iPhone / phones section */}
          <div className="mx-2 mb-4">
            <div className="flex items-center justify-between px-3 py-2 bg-white border-b border-gray-200">
              <span className="text-sm font-bold text-gray-900">iPhone 13 Pro — now reduced</span>
              <button onClick={onCategory} className="text-xs font-semibold" style={{ color: "#B8862E" }}>View more</button>
            </div>
            <div ref={phonesSlide.ref} {...phonesSlide.handlers} className="flex gap-0 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
              {(row4.length ? row4 : products.slice(2,6)).map((p, i) => (
                <HomeProductCard key={i} p={p} onView={() => onProduct(p)} onCart={() => onCart(p)} />
              ))}
            </div>
          </div>

          {/* Highlighted deals band */}
          <div className="mx-2 mb-4 rounded-sm overflow-hidden">
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
              {/* Left red promo */}
              <div className="p-4 flex flex-col justify-between" style={{ background: "#CC0000" }}>
                <div>
                  <div className="text-white text-xs font-bold mb-1 opacity-80">FEATURED</div>
                  <div className="text-white text-base font-black leading-tight">Huawei nova 11s</div>
                  <div className="text-white/70 text-xs mt-1">R3,449</div>
                </div>
                <button onClick={onCategory} className="self-start mt-3 bg-white text-red-700 text-xs font-bold px-3 py-1.5 rounded hover:bg-red-50 transition-colors">Shop Now</button>
              </div>
              {/* Middle black promo */}
              <div className="p-4 flex flex-col justify-between bg-gray-900">
                <div>
                  <div className="text-white text-xs font-bold mb-1 opacity-70">NEW</div>
                  <div className="text-white text-base font-black leading-tight">Huawei nova 11S Plus</div>
                  <div className="text-yellow-400 text-xs mt-1">R5,000 <span className="line-through text-gray-400 text-[10px]">R6,099</span></div>
                </div>
                <button onClick={onCategory} className="self-start mt-3 bg-yellow-400 text-gray-900 text-xs font-bold px-3 py-1.5 rounded hover:bg-yellow-300 transition-colors">Shop Now</button>
              </div>
              {/* Right product card */}
              <div className="bg-white border border-gray-200 flex flex-col">
                {(rowHL[0]) ? (
                  <HomeProductCard p={rowHL[0]} onView={() => onProduct(rowHL[0])} onCart={() => onCart(rowHL[0])} />
                ) : (
                  <div className="p-4 flex flex-col items-center justify-center h-full text-center">
                    <div className="text-4xl mb-2">📱</div>
                    <div className="text-xs font-bold text-gray-800">Huawei Y7S</div>
                    <div className="text-xs text-gray-500 mt-1">R2,999</div>
                    <button onClick={onCategory} className="mt-2 text-xs font-bold px-3 py-1 border-2 hover:bg-emerald-600 hover:text-white transition-colors" style={{ borderColor: "#B8862E", color: "#B8862E" }}>Add to cart</button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Top branded microwaves */}
          <div className="mx-2 mb-6">
            <ProductRow title="Top branded microwaves" products={row5.length ? row5 : products.slice(0,3)} onProduct={onProduct} onCart={onCart} slice={[0, 12]} />
          </div>

          {/* Flash deals if available */}
          {flashDeals.length > 0 && (
            <div className="mx-2 mb-4">
              <div className="flex items-center justify-between px-3 py-2 bg-white border-b border-gray-200">
                <div className="flex items-center gap-2">
                  <Zap className="w-3.5 h-3.5 text-red-500" />
                  <span className="text-sm font-bold text-gray-900">Flash Deals</span>
                </div>
                <button onClick={onCategory} className="text-xs font-semibold" style={{ color: "#B8862E" }}>View more</button>
              </div>
              <div ref={flashSlide.ref} {...flashSlide.handlers} className="flex gap-0 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
                {rotate(flashDeals, 0).map((p, i) => (
                  <HomeProductCard key={i} p={p} onView={() => onProduct(p)} onCart={() => onCart(p)} />
                ))}
              </div>
            </div>
          )}

          {/* Featured products */}
          {featured.length > 0 && (
            <div className="mx-2 mb-4">
              <ProductRow title="Recommended for you" products={rotate(featured, 2)} onProduct={onProduct} onCart={onCart} slice={[0, 12]} />
            </div>
          )}

          {/* Trust bar */}
          <div className="mx-2 mb-6 bg-gray-800 text-white flex flex-wrap justify-around items-center gap-4 px-4 py-3">
            {[
              { icon: "🚚", label: "Free Delivery", sub: "Orders over R500" },
              { icon: "🔒", label: "Buyer Protection", sub: "100% guaranteed" },
              { icon: "↩️", label: "Easy Returns", sub: "30-day policy" },
              { icon: "⚡", label: "Flash Deals", sub: "Daily offers" },
            ].map((b, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xl">{b.icon}</span>
                <div>
                  <p className="text-xs font-bold">{b.label}</p>
                  <p className="text-[10px] text-gray-400">{b.sub}</p>
                </div>
              </div>
            ))}
          </div>

          <Footer />
        </div>
      </div>
    </div>
  );
}

// ─── CATALOG ──────────────────────────────────────────────────────────────────
function CatalogView({ categories, onProduct, onCart, wishlistIds, onWishlist, initialSearch }: {
  categories: R[]; onProduct: (p: R) => void; onCart: (p: R) => void;
  wishlistIds: Set<string>; onWishlist: (id: string) => void; initialSearch?: string;
}) {
  const [products, setProducts] = useState<R[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState(initialSearch ?? "");
  const [activeCat, setActiveCat] = useState("");
  const [sort, setSort]         = useState("popular");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  useEffect(() => { if (initialSearch) setSearch(initialSearch); }, [initialSearch]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await mktProducts.list({ category: activeCat, search, sort });
      setProducts(res.data as R[]);
    } finally { setLoading(false); }
  }, [activeCat, search, sort]);

  useEffect(() => { load(); }, [load]);

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
        </select>
        {/* View toggle */}
        <div className="flex border border-gray-200 rounded-xl overflow-hidden">
          <button onClick={() => setViewMode("grid")}
            className={`p-2 transition-colors ${viewMode === "grid" ? "bg-emerald-50 text-emerald-700" : "text-gray-400"}`}>
            <Grid className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setViewMode("list")}
            className={`p-2 transition-colors ${viewMode === "list" ? "bg-emerald-50 text-emerald-700" : "text-gray-400"}`}>
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

      {/* Products */}
      <div className="flex-1 overflow-y-auto p-4" style={{ background: "#FAF6EC" }}>
        {!loading && !activeCat && !search && products.length > 0 && (
          <div className="-mx-4 -mt-4 mb-4">
            <ProductRow title="Popular right now" products={products} onProduct={onProduct} onCart={onCart} slice={[0, 10]} />
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#B8862E" }} />
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Search className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="font-semibold">No products found</p>
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
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
                  <div className="w-20 h-20 rounded-xl flex items-center justify-center text-3xl flex-shrink-0 overflow-hidden"
                    style={{ background: `linear-gradient(135deg,${imgs?.[0]},${imgs?.[1]})` }}>
                    {PRODUCT_ILLUSTRATIONS[p.id as string]
                      ? <div className="w-14 h-14">{PRODUCT_ILLUSTRATIONS[p.id as string]()}</div>
                      : (p.emoji as string)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-400">{p.brand as string}</p>
                    <p className="text-sm font-semibold text-gray-900 truncate">{p.name as string}</p>
                    <div className="flex items-center gap-1 mt-0.5"><Stars rating={Number(p.avgRating)} size={11} /></div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-base font-black text-gray-900">{fmtZAR(Number(p.price))}</p>
                    {p.compareAtPrice && <p className="text-xs text-gray-400 line-through">{fmtZAR(Number(p.compareAtPrice))}</p>}
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
        <Footer />
      </div>
    </div>
  );
}

// ─── PRODUCT DETAIL ───────────────────────────────────────────────────────────
function ProductDetailView({ productId, onBack, onCart, wishlistIds, onWishlist, authUser, onRequireAuth }: {
  productId: string; onBack: () => void;
  onCart: (p: R, variantId?: string) => void;
  wishlistIds: Set<string>; onWishlist: (id: string) => void;
  authUser: { id: string; name: string } | null; onRequireAuth: () => void;
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

  const submitReview = async () => {
    if (!authUser) { onRequireAuth(); return; }
    if (!reviewRating) return;
    setSubmittingReview(true);
    const res = await mktProducts.addReview(productId, { userId: authUser.id, rating: reviewRating, title: reviewTitle, body: reviewBody });
    setSubmittingReview(false);
    if ((res as { success: boolean }).success) {
      setReviewSubmitted(true);
      setReviewRating(0); setReviewTitle(""); setReviewBody("");
      mktProducts.get(productId).then(r => setData(r.data as typeof data));
    }
  };

  useEffect(() => {
    setLoading(true);
    mktProducts.get(productId)
      .then(res => { setData(res.data as typeof data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [productId]);

  if (loading) return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin" style={{ color: "#B8862E" }} /></div>;
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
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100"><ArrowLeft className="w-4 h-4 text-gray-700" /></button>
        <p className="text-sm font-semibold text-gray-900 flex-1 truncate">{p.name as string}</p>
        <button onClick={() => onWishlist(p.id as string)}>
          <Heart className={`w-5 h-5 ${inWishlist ? "fill-red-500 text-red-500" : "text-gray-400"}`} />
        </button>
      </div>

      <div className="grid xl:grid-cols-2">
        {/* Image */}
        <div>
          <Product3DViewer
            emoji={p.emoji as string}
            colorA={imgs?.[0] ?? "#B8862E"}
            colorB={imgs?.[1] ?? "#0F3D24"}
            brand={(p.brand as string) ?? ""}
            name={p.name as string}
            discount={discount}
            illustration={PRODUCT_ILLUSTRATIONS[p.id as string]}
          />
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
              <span className="text-xs text-gray-400">{p.brand as string}</span>
            </div>
            <h1 className="font-serif text-2xl text-gray-900 leading-snug" style={{ fontWeight: 600 }}>{p.name as string}</h1>
          </div>

          <div className="flex items-center gap-3">
            <Stars rating={Number(p.avgRating)} size={15} />
            <span className="text-sm font-bold text-gray-700">{Number(p.avgRating).toFixed(1)}</span>
            <span className="text-sm text-gray-400">({Number(p.reviewCount).toLocaleString()} reviews)</span>
          </div>

          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-black text-gray-900">{fmtZAR(Number(p.price))}</span>
            {p.compareAtPrice && (
              <>
                <span className="text-lg text-gray-400 line-through">{fmtZAR(Number(p.compareAtPrice))}</span>
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
              <span className="text-xs text-gray-400">{Number(p.stock)} in stock</span>
            </div>
          </div>

          {/* Delivery */}
          <div className="flex items-center gap-2.5 p-3 rounded-xl bg-green-50 border border-green-100">
            <Truck className="w-4 h-4 text-green-600 flex-shrink-0" />
            <div>
              <p className="text-xs font-semibold text-green-700">{Number(p.price) > 500 ? "Free delivery" : "R99 delivery"}</p>
              <p className="text-[10px] text-green-600">Estimated 3–5 business days</p>
            </div>
          </div>

          {/* CTAs */}
          <div className="flex gap-3">
            <button onClick={() => onCart(p, selVariant || undefined)}
              className="flex-1 py-3 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2"
              style={{ background: "linear-gradient(135deg,#D4A54A,#B8862E)" }}>
              <ShoppingCart className="w-4 h-4" />Add to Cart
            </button>
            <button onClick={() => onWishlist(p.id as string)}
              className={`px-4 rounded-2xl border transition-all ${inWishlist ? "bg-red-50 border-red-200" : "border-gray-200"}`}>
              <Heart className={`w-4 h-4 ${inWishlist ? "fill-red-500 text-red-500" : "text-gray-400"}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-t border-gray-100 px-6">
        <div className="flex border-b border-gray-100">
          {(["desc","reviews","seller"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-3.5 text-sm font-semibold transition-all border-b-2 -mb-px capitalize ${tab === t ? "border-emerald-600 text-emerald-600" : "border-transparent text-gray-400"}`}>
              {t === "desc" ? "Description" : t === "reviews" ? `Reviews (${reviews.length})` : "Seller"}
            </button>
          ))}
        </div>
        <div className="py-5">
          {tab === "desc" && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 leading-relaxed">{p.description as string}</p>
              {Object.keys(p.attributes as R ?? {}).length > 0 && (
                <div>
                  <p className="text-sm font-bold text-gray-800 mb-3">Specifications</p>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(p.attributes as R ?? {}).map(([k, v]) => (
                      <div key={k} className="flex justify-between text-sm py-2 border-b border-gray-50">
                        <span className="text-gray-400">{k}</span>
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
                        <span className="text-[11px] text-gray-400">by {r.reviewerName as string}</span>
                        {r.verifiedPurchase && <span className="text-[10px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full">✓ Verified</span>}
                      </div>
                    </div>
                    <span className="text-[11px] text-gray-400">{ago(r.createdAt as string)}</span>
                  </div>
                  <p className="text-sm text-gray-600">{r.body as string}</p>
                </div>
              ))}
              {reviews.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No reviews yet</p>}
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
                    <p className="text-[11px] text-gray-400">{s.label}</p>
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
          <h3 className="text-sm font-bold text-gray-900 my-4">Related Products</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {related.map((r, i) => (
              <ProductCard key={i} p={r} onView={() => onCart(r)} onCart={() => onCart(r)}
                wishlistIds={wishlistIds} onWishlist={() => onWishlist(String(r.id))} />
            ))}
          </div>
        </div>
      )}
      <Footer />
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
      <h2 className="text-lg font-bold text-gray-900">Your cart is empty</h2>
      <p className="text-sm text-gray-400">Browse products and add items to get started</p>
    </div>
  );

  return (
    <div className="flex-1 flex overflow-hidden" style={{ background: "#FAF6EC" }}>
      {/* Items */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <h2 className="text-base font-bold text-gray-900">Cart ({items.length})</h2>
        {items.map((item, i) => (
          <div key={i} className="bg-white rounded-2xl p-4 flex items-center gap-4 border border-gray-100">
            <div className="w-16 h-16 rounded-xl flex items-center justify-center text-3xl flex-shrink-0 bg-gray-50">
              {item.emoji as string}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{item.name as string}</p>
              <p className="text-xs text-gray-400">{item.sellerName as string}</p>
              <p className="text-sm font-bold mt-1" style={{ color: "#B8862E" }}>{fmtZAR(Number(item.unitPrice))}</p>
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
            <Tag className="w-4 h-4" style={{ color: "#B8862E" }} />
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
          <p className="text-[11px] text-gray-400 mt-1.5">Try: WELCOME10 · SAVE200 · FREESHIP</p>
        </div>
      </div>

      {/* Summary */}
      <div className="w-72 flex-shrink-0 p-4 bg-white border-l border-gray-100 overflow-y-auto">
        <h3 className="text-sm font-bold text-gray-900 mb-4">Order Summary</h3>
        <div className="space-y-2.5 mb-5">
          {[
            { label: "Subtotal",      value: fmtZAR(Number(cart?.subtotal ?? 0)) },
            { label: "Shipping",      value: Number(cart?.shipping) === 0 ? "Free" : fmtZAR(Number(cart?.shipping)) },
            { label: "Tax (15% VAT)", value: fmtZAR(Number(cart?.tax ?? 0)) },
            ...(Number(cart?.couponDiscount) > 0 ? [{ label: "Discount", value: `-${fmtZAR(Number(cart?.couponDiscount))}` }] : []),
          ].map((r, i) => (
            <div key={i} className="flex justify-between text-sm">
              <span className="text-gray-500">{r.label}</span>
              <span className={`font-semibold ${r.label === "Discount" ? "text-green-600" : "text-gray-900"}`}>{r.value}</span>
            </div>
          ))}
          <div className="border-t border-gray-100 pt-3 flex justify-between">
            <span className="font-bold text-gray-900">Total</span>
            <span className="text-xl font-black" style={{ color: "#B8862E" }}>{fmtZAR(Number(cart?.total ?? 0))}</span>
          </div>
        </div>
        <button onClick={onCheckout}
          className="w-full py-3.5 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2"
          style={{ background: "linear-gradient(135deg,#D4A54A,#B8862E)" }}>
          Proceed to Checkout <ChevronRight className="w-4 h-4" />
        </button>
        <div className="flex items-center justify-center gap-3 mt-4 text-xl">
          {["💳","🏦","📱","💰"].map((e, i) => <span key={i}>{e}</span>)}
        </div>
        <p className="text-center text-[10px] text-gray-400 mt-1">Secure checkout · PCI DSS</p>
      </div>
    </div>
  );
}

// ─── CHECKOUT ─────────────────────────────────────────────────────────────────
function CheckoutView({ cart, addresses, onBack, onComplete }: {
  cart: R | null; addresses: R[];
  onBack: () => void; onComplete: (order: R) => void;
}) {
  const [step, setStep]     = useState<CheckoutStep>("address");
  const [selAddr, setSelAddr] = useState(0);
  const [shipping, setShipping] = useState("standard");
  const [payment, setPayment] = useState("card");
  const [placing, setPlacing] = useState(false);
  const STEPS: CheckoutStep[] = ["address","shipping","payment","confirmation"];
  const si = STEPS.indexOf(step);

  const handlePlace = async () => {
    setPlacing(true);
    try {
      const { mktOrders: api } = await import("../services/marketplaceApi");
      const res = await api.place({ addressId: (addresses[selAddr] as R)?.id, shippingMethod: shipping, paymentMethod: payment });
      setStep("confirmation");
      onComplete(res.data as R);
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
              <span className="text-[10px] text-gray-400">{label}</span>
            </div>
            {i < 2 && <div className="flex-1 h-px mx-2 mt-3.5" style={{ background: si > i ? "#B8862E" : "#E5E7EB" }} />}
          </div>
        ))}
      </div>

      {step === "address" && (
        <div className="max-w-lg mx-auto space-y-4">
          <h2 className="text-base font-bold text-gray-900">Delivery Address</h2>
          {addresses.map((a, i) => (
            <button key={i} onClick={() => setSelAddr(i)}
              className={`w-full p-4 rounded-2xl text-left border transition-all ${selAddr === i ? "border-emerald-400 bg-emerald-50" : "border-gray-200 bg-white"}`}>
              <div className="flex items-start gap-3">
                <div className={`w-5 h-5 rounded-full border-2 mt-0.5 flex items-center justify-center flex-shrink-0 ${selAddr === i ? "border-emerald-600 bg-emerald-600" : "border-gray-300"}`}>
                  {selAddr === i && <div className="w-2 h-2 rounded-full bg-white" />}
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{a.label as string}</p>
                  <p className="text-xs text-gray-600">{a.firstName as string} {a.lastName as string}</p>
                  <p className="text-xs text-gray-500">{a.line1 as string}, {a.city as string} {a.postalCode as string}</p>
                </div>
              </div>
            </button>
          ))}
          <button onClick={() => setStep("shipping")}
            className="w-full py-3.5 rounded-2xl text-sm font-bold text-white"
            style={{ background: "linear-gradient(135deg,#D4A54A,#B8862E)" }}>
            Continue to Shipping
          </button>
        </div>
      )}

      {step === "shipping" && (
        <div className="max-w-lg mx-auto space-y-3">
          <h2 className="text-base font-bold text-gray-900">Shipping Method</h2>
          {[
            { id:"standard", label:"Standard Delivery", sub:"3–5 business days", price:"R99" },
            { id:"express",  label:"Express Delivery",  sub:"Next business day", price:"R199" },
            { id:"collect",  label:"Click & Collect",   sub:"At your nearest Ballylife Hub", price:"FREE" },
          ].map(opt => (
            <button key={opt.id} onClick={() => setShipping(opt.id)}
              className={`w-full p-4 rounded-2xl text-left border flex items-center gap-3 transition-all ${shipping === opt.id ? "border-emerald-400 bg-emerald-50" : "border-gray-200 bg-white"}`}>
              <Truck className="w-5 h-5 flex-shrink-0" style={{ color: "#B8862E" }} />
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-900">{opt.label}</p>
                <p className="text-xs text-gray-400">{opt.sub}</p>
              </div>
              <span className={`text-sm font-bold ${opt.price === "FREE" ? "text-green-600" : "text-gray-800"}`}>{opt.price}</span>
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
          <h2 className="text-base font-bold text-gray-900">Payment Method</h2>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id:"card",       label:"Card",              icon:"💳" },
              { id:"paypal",     label:"PayPal",            icon:"🔵" },
              { id:"apple_pay",  label:"Apple Pay",         icon:"🍎" },
              { id:"google_pay", label:"Google Pay",        icon:"🔴" },
              { id:"bnpl",       label:"Buy Now Pay Later", icon:"📅" },
              { id:"wallet",     label:"Ballylife Wallet",       icon:"👛" },
            ].map(opt => (
              <button key={opt.id} onClick={() => setPayment(opt.id)}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl border transition-all ${payment === opt.id ? "border-emerald-400 bg-emerald-50" : "border-gray-200 bg-white"}`}>
                <span className="text-xl">{opt.icon}</span>
                <span className="text-[10px] font-medium text-gray-700">{opt.label}</span>
              </button>
            ))}
          </div>
          {payment === "card" && (
            <div className="bg-white rounded-2xl p-4 border border-gray-100 space-y-3">
              {[
                { label:"Card Number", placeholder:"1234 5678 9012 3456" },
                { label:"Expiry",      placeholder:"MM / YY" },
                { label:"CVV",         placeholder:"•••" },
              ].map(f => (
                <div key={f.label}>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">{f.label}</label>
                  <input placeholder={f.placeholder}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-emerald-400" />
                </div>
              ))}
            </div>
          )}
          <div className="bg-white rounded-2xl p-4 border border-gray-100">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Order total</span>
              <span className="font-black" style={{ color: "#B8862E" }}>{fmtZAR(Number(cart?.total ?? 0))}</span>
            </div>
            <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-1"><Shield className="w-3 h-3" />256-bit SSL · PCI DSS compliant</p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setStep("shipping")} className="flex-1 py-3.5 rounded-2xl text-sm font-semibold border border-gray-200">Back</button>
            <button onClick={handlePlace} disabled={placing}
              className="flex-[2] py-3.5 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: "linear-gradient(135deg,#D4A54A,#B8862E)" }}>
              {placing ? <><Loader2 className="w-4 h-4 animate-spin" />Processing…</> : <>Place Order · {fmtZAR(Number(cart?.total ?? 0))}</>}
            </button>
          </div>
        </div>
      )}

      {step === "confirmation" && (
        <div className="max-w-lg mx-auto text-center py-10">
          <div className="w-24 h-24 rounded-full mx-auto flex items-center justify-center mb-5 text-5xl" style={{ background: "#F0FDF4" }}>✅</div>
          <h2 className="font-serif text-3xl text-gray-900 mb-2" style={{ fontWeight: 600 }}>Order Placed!</h2>
          <p className="text-gray-500 mb-6">Thank you! A confirmation email is on its way.</p>
          <div className="bg-white rounded-2xl p-5 border border-gray-100 mb-6 space-y-2 text-left">
            <div className="flex justify-between text-sm"><span className="text-gray-500">Total paid</span><span className="font-black" style={{ color: "#B8862E" }}>{fmtZAR(Number(cart?.total ?? 0))}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-500">Estimated delivery</span><span className="font-semibold">3–5 business days</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-500">Carrier</span><span className="font-semibold">DHL Express</span></div>
          </div>
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

  useEffect(() => {
    mktOrders.list().then(r => { setOrders(r.data as R[]); setLoading(false); });
  }, []);

  if (loading) return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin" style={{ color: "#B8862E" }} /></div>;

  if (selected) return (
    <div className="flex-1 overflow-y-auto p-4" style={{ background: "#FAF6EC" }}>
      <button onClick={() => setSelected(null)} className="flex items-center gap-2 text-sm font-semibold mb-4" style={{ color: "#B8862E" }}>
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
            <span className="text-2xl">{item.emoji as string}</span>
            <div className="flex-1"><p className="text-sm font-semibold text-gray-900">{item.productName as string}</p><p className="text-xs text-gray-400">Qty: {item.quantity as number}</p></div>
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
      <h2 className="text-base font-bold text-gray-900 mb-4">My Orders</h2>
      {orders.length === 0 ? (
        <div className="text-center py-16 text-gray-400"><Package className="w-12 h-12 mx-auto mb-3 opacity-20" /><p className="font-semibold">No orders yet</p></div>
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
                {(o.items as R[]).length > 3 && <span className="text-xs text-gray-400">+{(o.items as R[]).length - 3}</span>}
              </div>
              <div className="flex items-center justify-between text-xs text-gray-400">
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
function WishlistView({ wishlistIds, onProduct, onCart, onWishlist }: {
  wishlistIds: Set<string>; onProduct: (p: R) => void;
  onCart: (p: R) => void; onWishlist: (id: string) => void;
}) {
  const [items, setItems]   = useState<R[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { mktWishlist.get("demo-customer-001").then(r => { setItems(r.data as R[]); setLoading(false); }); }, []);
  if (loading) return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin" style={{ color: "#B8862E" }} /></div>;
  return (
    <div className="flex-1 overflow-y-auto p-4" style={{ background: "#FAF6EC" }}>
      <h2 className="text-base font-bold text-gray-900 mb-4">My Wishlist ({items.length})</h2>
      {items.length === 0
        ? <div className="text-center py-16 text-gray-400"><Heart className="w-12 h-12 mx-auto mb-3 opacity-20" /><p className="font-semibold">No saved items</p></div>
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
  const [view, setView]           = useState<View>("home");
  const [categories, setCategories] = useState<R[]>([]);
  const [products, setProducts]   = useState<R[]>([]);
  const [cart, setCart]           = useState<R | null>(null);
  const [wishlistIds, setWishlistIds] = useState<Set<string>>(new Set());
  const [addresses, setAddresses] = useState<R[]>([]);
  const [selProductId, setSelProductId] = useState("");
  const [cartCount, setCartCount] = useState(0);
  const [authUser, setAuthUser]   = useState<MktAuthUser | null>(null);
  const [authSeller, setAuthSeller] = useState<{ id: string; storeName: string; status: string } | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [navSearch, setNavSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [navSuggests, setNavSuggests] = useState<R[]>([]);
  const [showSuggests, setShowSuggests] = useState(false);
  const navSearchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const MANAGER_ROLES = ["superadmin", "noc_engineer", "billing_admin", "marketplace_admin"];
  const role: "customer" | "seller" | "manager" | null =
    !authUser ? null : MANAGER_ROLES.includes(authUser.role) ? "manager" : authUser.role === "seller" ? "seller" : "customer";

  useEffect(() => {
    // Marketplace is a fully independent account system now — its own
    // users table, its own JWT, no bridging with Vink's main app login.
    const restored = mktAuth.restoreSession();
    if (restored) { setAuthUser(restored.user); setAuthSeller(restored.seller); }
  }, []);

  useEffect(() => {
    if (initialAction === "sell" && !mktAuth.restoreSession()) setShowAuthModal(true);
  }, [initialAction]);

  useEffect(() => {
    if (initialProductId) { setSelProductId(initialProductId); setView("product"); }
    else if (initialAction === "shop") { setView("catalog"); }
  }, [initialAction, initialProductId]);

  const loadInitial = useCallback(async () => {
    const promises: Promise<unknown>[] = [mktCategories(), mktProducts.list({ sort: "popular", limit: "48" })];
    if (authUser) promises.push(mktCart.get(authUser.id), mktWishlist.get(authUser.id), mktAddresses(authUser.id));
    const results = await Promise.allSettled(promises);
    const [catRes, prodRes, cartRes, wishRes, addrRes] = results as PromiseSettledResult<{ data: unknown }>[];
    if (catRes.status  === "fulfilled") setCategories(catRes.value.data as R[]);
    if (prodRes.status === "fulfilled") setProducts(prodRes.value.data as R[]);
    if (authUser) {
      if (cartRes?.status === "fulfilled" && cartRes.value.data) setCart(cartRes.value.data as R);
      if (wishRes?.status === "fulfilled") setWishlistIds(new Set(((wishRes.value.data as R[]) ?? []).map(p => String(p.id))));
      if (addrRes?.status === "fulfilled") setAddresses((addrRes.value.data as R[]) ?? []);
    } else {
      setCart(null); setWishlistIds(new Set()); setAddresses([]);
    }
  }, [authUser]);

  useEffect(() => { loadInitial(); }, [loadInitial]);
  useEffect(() => { setCartCount(((cart?.items as R[]) ?? []).length); }, [cart]);

  const handleAddToCart = async (p: R, variantId?: string) => {
    if (!authUser) { setShowAuthModal(true); return; }
    const res = await mktCart.add(authUser.id, { productId: p.id, variantId: variantId ?? null, quantity: 1 });
    setCart(res.data as R);
  };

  const handleUpdateQty = async (productId: string, qty: number) => {
    if (!authUser) return;
    if (qty <= 0) { await mktCart.remove(authUser.id, productId); }
    else { await mktCart.update(authUser.id, productId, qty); }
    loadInitial();
  };

  const handleRemove = async (productId: string) => {
    if (!authUser) return;
    await mktCart.remove(authUser.id, productId);
    loadInitial();
  };

  const handleCoupon = async (code: string) => {
    if (!authUser) return;
    const res = await mktCart.coupon(authUser.id, code);
    if (res.data) setCart(res.data as R);
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

  const handleAuthenticated = (user: MktAuthUser, seller: { id: string; storeName: string; status: string } | null) => {
    setAuthUser(user);
    setAuthSeller(seller);
    setShowAuthModal(false);
    const dest = MANAGER_ROLES.includes(user.role) ? "admin" : user.role === "seller" ? "seller" : "account";
    setView(dest as View);
  };

  const handleSignOut = () => {
    mktAuth.logout();
    setAuthUser(null);
    setAuthSeller(null);
    setCart(null);
    setWishlistIds(new Set());
    setAddresses([]);
    setView("home");
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

  const CATEGORY_QUICK_LINKS = (categories as R[]).slice(0, 8);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#EAEDED]" style={{ fontFamily: "'Amazon Ember', Arial, sans-serif" }}>
      {/* ── Tier 1: dark top strip ── */}
      <header className="flex items-center gap-2 sm:gap-4 px-3 sm:px-4 py-2 flex-shrink-0 z-20" style={{ background: "#14110D" }}>
        <button
          onClick={() => { setView("home"); }}
          className="flex items-center px-2 py-1 rounded border border-transparent hover:border-white/40 shrink-0"
        >
          <img src={ballylifeLogo} alt="Ballylife" className="h-9 w-auto" />
        </button>

        <div className="relative group hidden lg:block shrink-0">
          <button className="flex flex-col items-start px-2 py-1 rounded border border-transparent hover:border-white/40 text-white">
            <span className="flex items-center gap-1 text-[10px] text-white/60 leading-none">
              <MapPin className="w-3 h-3" /> Deliver to
            </span>
            <span className="text-xs font-bold leading-tight mt-0.5">{currency.country.country ?? currency.country.countryCode}</span>
          </button>
          <div className="absolute left-0 top-full mt-0 w-64 bg-white rounded-b shadow-2xl border border-gray-200 py-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-30 max-h-80 overflow-y-auto">
            <p className="px-3 pb-2 mb-1 border-b border-gray-100 text-[11px] text-gray-400">
              Prices shown in your local currency, converted from ZAR at today's rate.{currency.ratesStale ? " (using last known rate)" : ""}
            </p>
            {currency.countries.map(c => (
              <button
                key={c.countryCode}
                onClick={() => setCountryManually(c.countryCode)}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 flex items-center justify-between"
                style={{ color: currency.country.countryCode === c.countryCode ? "#D4A54A" : "#111827", fontWeight: currency.country.countryCode === c.countryCode ? 700 : 400 }}
              >
                <span>{c.country ?? c.countryCode}</span>
                <span className="text-gray-400 text-xs">{c.code}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="relative flex-1 flex items-stretch max-w-3xl rounded overflow-hidden h-9 min-w-0">
          <div className="hidden sm:flex items-center bg-[#E8E8E8] hover:bg-[#DDD] px-2 text-[11px] text-gray-700 border-r border-gray-300 shrink-0 cursor-pointer">
            All <ChevronDown className="w-3 h-3 ml-1" />
          </div>
          <input
            value={navSearch}
            onChange={e => onNavSearchChange(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") runSearch(navSearch); if (e.key === "Escape") setShowSuggests(false); }}
            onFocus={() => { if (navSuggests.length) setShowSuggests(true); }}
            onBlur={() => setTimeout(() => setShowSuggests(false), 150)}
            placeholder="Search Ballylife"
            className="flex-1 min-w-0 bg-white px-3 text-sm outline-none text-gray-800"
          />
          <button onClick={() => runSearch(navSearch)} className="w-11 flex items-center justify-center shrink-0" style={{ background: "#D4A54A" }}>
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
                  <span className="text-gray-400 text-xs shrink-0 ml-2">{String(s.category)}</span>
                </button>
              ))}
              <button
                onMouseDown={() => runSearch(navSearch)}
                className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-left border-t border-gray-100"
                style={{ color: "#B8862E" }}
              >
                <Search className="w-3.5 h-3.5" /> See all results for "{navSearch}"
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-0.5 sm:gap-1 ml-auto shrink-0">
          <div className="relative group hidden md:block">
            <button onClick={() => { if (!authUser) setShowAuthModal(true); }} className="flex flex-col items-start px-2 py-1 rounded border border-transparent hover:border-white/40 text-white">
              <span className="text-[10px] text-white/60 leading-none flex items-center gap-1">
                <User className="w-3 h-3" /> Hello, {authUser ? authUser.name.split(" ")[0] : "sign in"}
              </span>
              <span className="text-xs font-bold leading-tight mt-0.5 flex items-center gap-0.5">
                Account &amp; Lists <ChevronDown className="w-3 h-3" />
              </span>
            </button>
            {authUser && (
              <div className="absolute right-0 top-full mt-0 w-56 bg-white rounded-b shadow-2xl border border-gray-200 py-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-30">
                <p className="px-3 pb-2 mb-1 border-b border-gray-100 text-[11px] text-gray-400">Signed in as {authUser.username} ({role})</p>
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
              <span className="text-[10px] text-white/60 leading-none">Returns</span>
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
          <button onClick={() => setView("catalog")} className="text-white/85 text-xs font-medium whitespace-nowrap hover:text-white transition-colors ml-auto">
            Today's Deals
          </button>
        )}
        {navItems.map(item => (
          <button key={item.id} onClick={() => setView(item.id)}
            className="hidden md:flex items-center gap-1 text-xs font-medium whitespace-nowrap transition-colors"
            style={{ color: view === item.id ? "#D4A54A" : "rgba(255,255,255,0.85)" }}>
            {item.icon} {item.label}
          </button>
        ))}
        {isDemoMode() && (
          <span className="hidden xl:inline text-[10px] text-amber-300 whitespace-nowrap ml-auto md:ml-4">⚡ Demo Mode</span>
        )}
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
            />
          )}
          {view === "catalog" && (
            <CatalogView
              categories={categories}
              onProduct={p => { setSelProductId(String(p.id)); setView("product"); }}
              onCart={handleAddToCart}
              wishlistIds={wishlistIds} onWishlist={handleWishlist}
              initialSearch={submittedSearch}
            />
          )}
          {view === "product" && (
            <ProductDetailView
              productId={selProductId}
              onBack={() => setView("catalog")}
              onCart={(p, v) => { handleAddToCart(p, v); setView("cart"); }}
              wishlistIds={wishlistIds} onWishlist={handleWishlist}
              authUser={authUser} onRequireAuth={() => setShowAuthModal(true)}
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
              cart={cart} addresses={addresses}
              onBack={() => setView("home")}
              onComplete={() => { loadInitial(); setView("account"); }}
            />
          )}
          {view === "wishlist" && authUser && (
            <WishlistView
              wishlistIds={wishlistIds}
              onProduct={p => { setSelProductId(String(p.id)); setView("product"); }}
              onCart={handleAddToCart} onWishlist={handleWishlist}
            />
          )}
          {view === "account" && authUser && role === "customer" && (
            <CustomerDashboard user={authUser} onProduct={id => { setSelProductId(id); setView("product"); }} onSignOut={handleSignOut} />
          )}
          {view === "seller" && authUser && authSeller && role === "seller" && (
            <SellerDashboard user={authUser} seller={authSeller} onSignOut={handleSignOut} />
          )}
          {view === "admin" && authUser && role === "manager" && (
            <ManagerDashboard user={authUser} onSignOut={handleSignOut} />
          )}
      </div>

      {showAuthModal && <MarketplaceAuthModal onClose={() => setShowAuthModal(false)} onAuthenticated={handleAuthenticated} initialTab={initialAction === "sell" ? "seller" : "signin"} />}
    </div>
  );
}
