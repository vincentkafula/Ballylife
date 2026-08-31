import { useState, useEffect, useRef } from "react";
import { ShoppingBag, Store, Tag, ArrowRight, X, Star, Loader2 } from "lucide-react";
import heroBg from "../imports/assets/marketplace-hero-wide-bg.png";
import { mktProducts } from "../services/marketplaceApi";
import { formatZAR, useCurrency } from "../services/currencyStore";
import { Footer } from "./Footer";

// Same continuous drift-left auto-slide used on the home marketplace's
// product rows — pauses on hover/touch, loops back to the start at the end.
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
        if (max > 0) el.scrollLeft = el.scrollLeft >= max - 1 ? 0 : el.scrollLeft + speed;
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

type R = Record<string, unknown>;

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onShop: (productId?: string) => void;
  onSell: () => void;
}

const fmtZAR = formatZAR; // now converts + formats in the shopper's local currency

function ProductCard({ p, onClick }: { p: R; onClick: () => void }) {
  const imgs = p.images as string[];
  const discount = p.compareAtPrice ? Math.round((1 - Number(p.price) / Number(p.compareAtPrice)) * 100) : 0;
  return (
    <button onClick={onClick} className="w-full text-left bg-white rounded-2xl border border-gray-100 overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition-all">
      <div className="relative flex items-center justify-center h-32" style={{ background: `linear-gradient(135deg,${imgs?.[0] ?? "#eee"},${imgs?.[1] ?? "#ddd"})` }}>
        <span className="text-5xl">{p.emoji as string}</span>
        {discount > 0 && <span className="absolute top-2 left-2 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">-{discount}%</span>}
        {Boolean(p.isFlashDeal) && <span className="absolute top-2 right-2 bg-amber-400 text-white text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5"><Tag className="w-2.5 h-2.5" /> Deal</span>}
      </div>
      <div className="p-3">
        <p className="text-xs text-gray-400 mb-0.5">{p.brand as string}</p>
        <p className="text-sm font-semibold text-gray-900 line-clamp-2 leading-snug mb-1.5" style={{ minHeight: 34 }}>{p.name as string}</p>
        <div className="flex items-center gap-1 mb-1.5">
          <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
          <span className="text-[11px] text-gray-500">{Number(p.avgRating).toFixed(1)} ({String(p.reviewCount)})</span>
        </div>
        <div className="flex items-baseline gap-1.5">
          {Boolean(p.compareAtPrice) && <span className="text-[11px] text-gray-400 line-through">{fmtZAR(Number(p.compareAtPrice))}</span>}
          <span className="text-sm font-black" style={{ color: "#128A43" }}>{fmtZAR(Number(p.price))}</span>
        </div>
      </div>
    </button>
  );
}

export function MarketplaceLandingViewer({ isOpen, onClose, onShop, onSell }: Props) {
  useCurrency(); // subscribes this tree to live currency/rate updates
  const [products, setProducts] = useState<R[]>([]);
  const [loading, setLoading] = useState(true);
  const slide = useAutoSlide<HTMLDivElement>(products.length);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    mktProducts.list({ sort: "popular", limit: "48" })
      .then(r => setProducts((r.data as R[]) ?? []))
      .finally(() => setLoading(false));
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-white">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <img src={heroBg} alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-white/10" />

        <button
          onClick={onClose}
          className="absolute top-5 right-5 z-10 p-2 rounded-full bg-white/80 hover:bg-white shadow-sm transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4 text-gray-700" />
        </button>

        <div className="relative max-w-2xl mx-auto px-6 sm:px-10 py-16 sm:py-20 text-center">
          <div className="backdrop-blur-md rounded-[28px] px-6 sm:px-12 py-10 sm:py-12" style={{ background: "rgba(255,255,255,0.55)", boxShadow: "0 20px 60px -20px rgba(15,61,36,0.25)", border: "1px solid rgba(255,255,255,0.6)" }}>
            <h1 className="text-3xl sm:text-4xl font-black leading-[1.1] tracking-tight" style={{ color: "#0F3D24" }}>
              Everything you need,<br />
              <span style={{ background: "linear-gradient(90deg,#128A43,#FF9900)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                from sellers you trust
              </span>
            </h1>
            <p className="text-sm sm:text-base text-gray-600 mt-4 max-w-md mx-auto leading-relaxed">
              Thousands of real products across electronics, fashion, home, and more — with buyer protection on every order.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-7">
              <button
                onClick={() => onShop()}
                className="flex items-center gap-2 px-6 py-3 rounded-full text-white text-sm font-bold transition-all hover:-translate-y-0.5"
                style={{ background: "linear-gradient(135deg,#FF9900,#E67E00)", boxShadow: "0 10px 24px -8px rgba(230,126,0,0.55)" }}
              >
                <ShoppingBag className="w-4 h-4" /> Start Shopping
              </button>
              <button
                onClick={onSell}
                className="flex items-center gap-2 px-6 py-3 rounded-full text-sm font-bold border transition-all hover:-translate-y-0.5"
                style={{ borderColor: "#128A43", color: "#0F3D24", background: "rgba(255,255,255,0.85)", boxShadow: "0 6px 16px -8px rgba(15,61,36,0.2)" }}
              >
                <Store className="w-4 h-4" /> Become a Seller <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Full product catalogue */}
      <div className="max-w-6xl mx-auto px-6 sm:px-10 pt-10 pb-14">
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-xl sm:text-2xl font-black" style={{ color: "#0F3D24" }}>Shop the full catalogue</p>
            <p className="text-sm text-gray-500 mt-1">{products.length} products, live from the marketplace right now.</p>
          </div>
          <button onClick={() => onShop()} className="hidden sm:flex items-center gap-1.5 text-sm font-bold" style={{ color: "#128A43" }}>
            Open full store <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : (
          <div ref={slide.ref} {...slide.handlers} className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
            {products.map((p, i) => (
              <div key={i} className="w-40 sm:w-44 shrink-0">
                <ProductCard p={p} onClick={() => onShop(String(p.id))} />
              </div>
            ))}
          </div>
        )}

        <div className="flex sm:hidden justify-center mt-6">
          <button onClick={() => onShop()} className="flex items-center gap-1.5 text-sm font-bold" style={{ color: "#128A43" }}>
            Open full store <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Bottom CTA banner */}
      <div className="relative overflow-hidden mx-4 sm:mx-8 mb-10 rounded-2xl">
        <img src={heroBg} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ transform: "scaleY(-1)" }} />
        <div className="absolute inset-0 bg-white/15" />
        <div className="relative flex flex-col sm:flex-row items-center justify-between gap-4 px-6 sm:px-9 py-8">
          <div className="text-center sm:text-left">
            <p className="text-lg font-black" style={{ color: "#0F3D24" }}>Ready to list your first product?</p>
            <p className="text-sm text-gray-600 mt-1">Free to apply — approval usually within a business day.</p>
          </div>
          <button
            onClick={onSell}
            className="flex items-center gap-2 px-6 py-3 rounded-full text-white text-sm font-bold shadow-lg shrink-0"
            style={{ background: "linear-gradient(135deg,#128A43,#0F3D24)" }}
          >
            <Store className="w-4 h-4" /> Start Your Store <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <Footer />
    </div>
  );
}
