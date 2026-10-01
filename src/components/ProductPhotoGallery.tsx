import { useState, useCallback, useEffect, useRef, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import { ChevronLeft, ChevronRight, Box, X } from "lucide-react";

interface Props {
  emoji: string;
  colorA: string;
  colorB: string;
  name: string;
  discount?: number;
  illustration?: () => ReactNode;
  /** Real product photos (already resolved to absolute URLs). When present
   *  the gallery pages through these instead of the illustrated angles. */
  photos?: string[];
  /** Rendered as a small toggle in the corner so the existing interactive
   *  3D cube viewer stays reachable, instead of removing that feature. */
  onOpen3DView?: () => void;
}

// Five fixed "angle" presets for products without photos: the same
// illustration/emoji and colour pair, each frame a distinct tilt and
// background so paging through reads as different angles.
const ANGLES: { label: string; artTransform: string; bg: string; shade: number }[] = [
  { label: "Front", artTransform: "none", bg: "135deg", shade: 1 },
  { label: "Left", artTransform: "perspective(600px) rotateY(-22deg)", bg: "100deg", shade: 0.93 },
  { label: "Right", artTransform: "perspective(600px) rotateY(22deg)", bg: "170deg", shade: 0.93 },
  { label: "Top", artTransform: "perspective(600px) rotateX(20deg) scale(1.04)", bg: "60deg", shade: 1.05 },
  { label: "Detail", artTransform: "scale(1.55)", bg: "200deg", shade: 0.97 },
];

// Hover zoom (desktop): a lens follows the cursor over the photo and the
// area under it is shown enlarged in a panel to the right of the photo,
// over the product details -- like Amazon's "roll over image to zoom in".
const ZOOM_PANE = { width: 620, height: 520 };
const MIN_ZOOM = 2.5;   // at least this much larger than the photo on screen
const MAX_ZOOM = 4;

/** True on a large screen with a real mouse (hover zoom makes no sense on touch). */
function useHoverZoomAvailable(): boolean {
  const query = "(hover: hover) and (pointer: fine) and (min-width: 1024px)";
  const [ok, setOk] = useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.(query).matches));
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setOk(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return ok;
}

interface ZoomState {
  lens: { left: number; top: number; width: number; height: number }; // px, relative to the photo frame
  bg: { width: number; height: number; x: number; y: number };         // zoomed image size and offset
}

export function ProductPhotoGallery({ emoji, colorA, colorB, name, discount, illustration, photos = [], onOpen3DView }: Props) {
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState<ZoomState | null>(null);
  const [lightbox, setLightbox] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const hasPhotos = photos.length > 0;
  const count = hasPhotos ? photos.length : ANGLES.length;
  const canZoom = useHoverZoomAvailable() && hasPhotos;

  const go = useCallback((delta: number) => {
    setIndex(i => (i + delta + count) % count);
  }, [count]);

  const angle = ANGLES[index % ANGLES.length];

  const onMove = (e: ReactMouseEvent) => {
    const img = imgRef.current, frame = frameRef.current;
    if (!canZoom || !img || !frame || !img.naturalWidth) return;
    // The photo is drawn with object-contain (plus padding): work out the box it actually fills.
    const r = img.getBoundingClientRect();
    const cs = getComputedStyle(img);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const boxW = r.width - padX, boxH = r.height - padY;
    const fit = Math.min(boxW / img.naturalWidth, boxH / img.naturalHeight);
    const cw = img.naturalWidth * fit, ch = img.naturalHeight * fit;
    const ox = r.left + parseFloat(cs.paddingLeft) + (boxW - cw) / 2;
    const oy = r.top + parseFloat(cs.paddingTop) + (boxH - ch) / 2;
    const px = e.clientX - ox, py = e.clientY - oy;
    if (px < 0 || py < 0 || px > cw || py > ch) { setZoom(null); return; }

    // Zoomed image: the photo's own resolution, kept between 2.5x and 4x of what's on screen.
    const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, img.naturalWidth / cw));
    const f = frame.getBoundingClientRect();
    // The lens covers exactly what the zoom panel shows.
    const lw = Math.min(cw, ZOOM_PANE.width / scale), lh = Math.min(ch, ZOOM_PANE.height / scale);
    const lx = Math.min(Math.max(px - lw / 2, 0), cw - lw);
    const ly = Math.min(Math.max(py - lh / 2, 0), ch - lh);
    setZoom({
      lens: { left: ox - f.left + lx, top: oy - f.top + ly, width: lw, height: lh },
      bg: { width: cw * scale, height: ch * scale, x: -lx * scale, y: -ly * scale },
    });
  };

  // Full-screen view: arrow keys page, Escape closes, page behind doesn't scroll.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(false);
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [lightbox, go]);

  const thumbs = hasPhotos
    ? photos.map((src, i) => (
      <button
        key={src}
        onClick={() => setIndex(i)}
        onMouseEnter={() => { if (canZoom) setIndex(i); }}
        aria-label={`View photo ${i + 1}`}
        aria-current={i === index}
        className="shrink-0 w-14 h-14 rounded-lg overflow-hidden bg-white transition-shadow"
        style={{ border: i === index ? "2px solid #1E7B4D" : "1px solid #D1D5DB", boxShadow: i === index ? "0 0 0 2px rgba(30,123,77,0.15)" : "none" }}
      >
        <img src={src} alt="" loading="lazy" className="w-full h-full object-contain pointer-events-none" />
      </button>
    ))
    : ANGLES.map((a, i) => (
      <button
        key={a.label}
        onClick={() => setIndex(i)}
        aria-label={`View photo ${i + 1}: ${a.label}`}
        aria-current={i === index}
        className="shrink-0 w-14 h-14 rounded-lg flex items-center justify-center overflow-hidden transition-all"
        style={{
          background: `linear-gradient(${a.bg}, ${colorA} 0%, ${colorB} 100%)`,
          border: i === index ? "2px solid #1E7B4D" : "2px solid transparent",
          opacity: i === index ? 1 : 0.6,
        }}
      >
        <div className="w-7 h-7 flex items-center justify-center pointer-events-none" style={{ transform: a.artTransform }}>
          {illustration ? illustration() : <span className="text-xl select-none">{emoji}</span>}
        </div>
      </button>
    ));

  return (
    <div className="relative lg:flex lg:gap-3">
      {/* Thumbnails: a column beside the photo on large screens */}
      <div className="hidden lg:flex flex-col gap-2 max-h-[520px] overflow-y-auto pr-1 py-0.5">{thumbs}</div>

      <div className="relative flex-1 min-w-0">
        <div
          ref={frameRef}
          role="group"
          aria-label={`${name} photos, image ${index + 1} of ${count}`}
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "ArrowLeft") go(-1); if (e.key === "ArrowRight") go(1); }}
          onMouseMove={onMove}
          onMouseLeave={() => setZoom(null)}
          className="relative flex items-center justify-center outline-none rounded-lg"
          style={hasPhotos ? { minHeight: 340, background: "#FFFFFF", overflow: "hidden" } : {
            minHeight: 340,
            background: `linear-gradient(${angle.bg}, ${colorA} 0%, ${colorB} 100%)`,
            filter: `brightness(${angle.shade})`,
            overflow: "hidden",
          }}
        >
          {hasPhotos ? (
            <img
              ref={imgRef}
              src={photos[index]}
              alt={`${name} — photo ${index + 1}`}
              onClick={() => setLightbox(true)}
              className="w-full h-[340px] sm:h-[440px] lg:h-[520px] object-contain p-4 select-none"
              style={{ cursor: canZoom ? "crosshair" : "zoom-in" }}
              draggable={false}
            />
          ) : (
            <div className="w-40 h-40 flex items-center justify-center" style={{ transform: angle.artTransform, transition: "transform 0.35s ease" }}>
              {illustration ? illustration() : <span className="text-9xl select-none">{emoji}</span>}
            </div>
          )}

          {/* Lens over the area being magnified */}
          {zoom && (
            <div
              aria-hidden
              className="absolute pointer-events-none"
              style={{
                left: zoom.lens.left, top: zoom.lens.top, width: zoom.lens.width, height: zoom.lens.height,
                background: "rgba(255,255,255,0.35)", border: "1px solid rgba(17,24,39,0.35)",
              }}
            />
          )}

          {Boolean(discount) && (
            <span className="absolute top-4 left-4 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-md">-{discount}%</span>
          )}

          {/* Counter and arrows (hidden while zooming so they don't get in the way) */}
          {!zoom && (
            <>
              <span className="absolute bottom-3 right-3 text-[11px] font-bold px-2.5 py-1 rounded-full bg-black/35 text-white backdrop-blur-sm">
                {index + 1} / {count}
              </span>
              <button onClick={() => go(-1)} aria-label="Previous photo"
                className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center bg-white/85 hover:bg-white text-gray-800 shadow-md transition-transform hover:scale-105">
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button onClick={() => go(1)} aria-label="Next photo"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center bg-white/85 hover:bg-white text-gray-800 shadow-md transition-transform hover:scale-105">
                <ChevronRight className="w-5 h-5" />
              </button>
            </>
          )}

          {onOpen3DView && !zoom && (
            <button onClick={onOpen3DView}
              className="absolute top-3 right-3 flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full bg-white/85 hover:bg-white text-gray-700">
              <Box className="w-3 h-3" /> 3D view
            </button>
          )}
        </div>

        {hasPhotos && (
          <p className="text-center text-xs text-gray-500 mt-2">
            {canZoom ? "Roll over image to zoom in · click for full view" : "Tap image to view full screen"}
          </p>
        )}

        {/* Zoomed view, beside the photo and over the product details */}
        {zoom && hasPhotos && (
          <div
            aria-hidden
            className="absolute z-40 pointer-events-none bg-white border border-gray-200 rounded-lg shadow-2xl"
            style={{
              left: "calc(100% + 16px)", top: 0, width: ZOOM_PANE.width, height: ZOOM_PANE.height,
              backgroundImage: `url("${photos[index]}")`, backgroundRepeat: "no-repeat",
              backgroundSize: `${zoom.bg.width}px ${zoom.bg.height}px`,
              backgroundPosition: `${zoom.bg.x}px ${zoom.bg.y}px`,
            }}
          />
        )}
      </div>

      {/* Thumbnails: a row under the photo on phones and tablets */}
      <div className="flex lg:hidden items-center gap-2 px-1 py-2.5 overflow-x-auto">{thumbs}</div>

      {/* Full-screen view */}
      {lightbox && hasPhotos && (
        <div className="fixed inset-0 z-[100] bg-white flex flex-col" role="dialog" aria-modal="true" aria-label={`${name} photos`}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-900 truncate pr-4">{name}</p>
            <button onClick={() => setLightbox(false)} aria-label="Close" className="p-2 rounded-full hover:bg-gray-100"><X className="w-5 h-5 text-gray-700" /></button>
          </div>
          <div className="relative flex-1 min-h-0 flex items-center justify-center p-4">
            <img src={photos[index]} alt={`${name} — photo ${index + 1}`} className="max-w-full max-h-full object-contain" />
            {count > 1 && (
              <>
                <button onClick={() => go(-1)} aria-label="Previous photo" className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full flex items-center justify-center bg-white shadow-md border border-gray-100"><ChevronLeft className="w-6 h-6" /></button>
                <button onClick={() => go(1)} aria-label="Next photo" className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full flex items-center justify-center bg-white shadow-md border border-gray-100"><ChevronRight className="w-6 h-6" /></button>
              </>
            )}
          </div>
          <div className="flex justify-center gap-2 px-4 py-3 border-t border-gray-100 overflow-x-auto">{thumbs}</div>
        </div>
      )}
    </div>
  );
}
