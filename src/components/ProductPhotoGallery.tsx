import { useState, useCallback, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Box } from "lucide-react";

interface Props {
  emoji: string;
  colorA: string;
  colorB: string;
  name: string;
  discount?: number;
  illustration?: () => ReactNode;
  /** Rendered as a small toggle in the corner so the existing interactive
   *  3D cube viewer stays reachable, instead of removing that feature. */
  onOpen3DView?: () => void;
}

// Five fixed "angle" presets applied to the same illustration/emoji and
// colour pair a product already has -- there's no real product-photography
// pipeline behind this catalog (everything is emoji + generated
// illustration + brand colour), so rather than pretend otherwise, each
// frame is a genuinely different-looking static composition: a distinct
// tilt/rotation of the artwork plus its own background gradient angle and
// shading, so paging through does read as looking at the product from a
// different angle rather than the same flat image five times.
const ANGLES: { label: string; artTransform: string; bg: string; shade: number }[] = [
  { label: "Front", artTransform: "none", bg: "135deg", shade: 1 },
  { label: "Left", artTransform: "perspective(600px) rotateY(-22deg)", bg: "100deg", shade: 0.93 },
  { label: "Right", artTransform: "perspective(600px) rotateY(22deg)", bg: "170deg", shade: 0.93 },
  { label: "Top", artTransform: "perspective(600px) rotateX(20deg) scale(1.04)", bg: "60deg", shade: 1.05 },
  { label: "Detail", artTransform: "scale(1.55)", bg: "200deg", shade: 0.97 },
];

export function ProductPhotoGallery({ emoji, colorA, colorB, name, discount, illustration, onOpen3DView }: Props) {
  const [index, setIndex] = useState(0);

  const go = useCallback((delta: number) => {
    setIndex(i => (i + delta + ANGLES.length) % ANGLES.length);
  }, []);

  const angle = ANGLES[index];

  return (
    <div className="relative" style={{ minHeight: 340 }}>
      <div
        role="group"
        aria-label={`${name} photos, image ${index + 1} of ${ANGLES.length}`}
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "ArrowLeft") go(-1); if (e.key === "ArrowRight") go(1); }}
        className="relative flex items-center justify-center outline-none"
        style={{
          minHeight: 340,
          background: `linear-gradient(${angle.bg}, ${colorA} 0%, ${colorB} 100%)`,
          filter: `brightness(${angle.shade})`,
          overflow: "hidden",
        }}
      >
        <div className="w-40 h-40 flex items-center justify-center" style={{ transform: angle.artTransform, transition: "transform 0.35s ease" }}>
          {illustration ? illustration() : <span className="text-9xl select-none">{emoji}</span>}
        </div>

        {Boolean(discount) && (
          <span className="absolute top-4 left-4 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-md">-{discount}%</span>
        )}

        {/* Image counter */}
        <span className="absolute bottom-3 right-3 text-[11px] font-bold px-2.5 py-1 rounded-full bg-black/35 text-white backdrop-blur-sm">
          {index + 1} / {ANGLES.length}
        </span>

        {/* Arrow navigation */}
        <button
          onClick={() => go(-1)}
          aria-label="Previous photo"
          className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center bg-white/85 hover:bg-white text-gray-800 shadow-md transition-transform hover:scale-105"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <button
          onClick={() => go(1)}
          aria-label="Next photo"
          className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center bg-white/85 hover:bg-white text-gray-800 shadow-md transition-transform hover:scale-105"
        >
          <ChevronRight className="w-5 h-5" />
        </button>

        {onOpen3DView && (
          <button
            onClick={onOpen3DView}
            className="absolute top-3 right-3 flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full bg-white/85 hover:bg-white text-gray-700"
          >
            <Box className="w-3 h-3" /> 3D view
          </button>
        )}
      </div>

      {/* Thumbnail strip */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-white border-t border-gray-100 overflow-x-auto">
        {ANGLES.map((a, i) => (
          <button
            key={a.label}
            onClick={() => setIndex(i)}
            aria-label={`View photo ${i + 1}: ${a.label}`}
            aria-current={i === index}
            className="shrink-0 w-12 h-12 rounded-lg flex items-center justify-center overflow-hidden transition-all"
            style={{
              background: `linear-gradient(${a.bg}, ${colorA} 0%, ${colorB} 100%)`,
              border: i === index ? "2px solid #B8862E" : "2px solid transparent",
              opacity: i === index ? 1 : 0.6,
            }}
          >
            <div className="w-7 h-7 flex items-center justify-center pointer-events-none" style={{ transform: a.artTransform }}>
              {illustration ? illustration() : <span className="text-xl select-none">{emoji}</span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
