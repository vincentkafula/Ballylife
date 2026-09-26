import { useRef, useState, useEffect, useCallback, type ReactNode } from "react";
import { RotateCcw, Play, Pause, ZoomIn, ZoomOut, Box, Image as ImageIcon } from "lucide-react";

interface Props {
  emoji: string;
  colorA: string;
  colorB: string;
  brand: string;
  name: string;
  discount?: number;
  /** Optional original illustration to render instead of the emoji, for
   *  listings that have one (see PRODUCT_ILLUSTRATIONS in VinkMarketplace). */
  illustration?: () => ReactNode;
  /** The product's real photos (absolute URLs). When present the 3D view is
   *  built from them; the emoji cube is only a fallback for listings with
   *  no photography at all. */
  photos?: string[];
}

const SIZE = 180; // half-extent of the fallback cube in px (face size = SIZE)
const MAX_RING_PHOTOS = 10;

/**
 * Interactive 3D view of a product.
 *
 * Suppliers don't publish 3D meshes, so the depth comes from the product's
 * own photography rather than an invented model:
 *  - 2+ photos: the photos stand in a ring on a 3D stage (CSS perspective +
 *    preserve-3d). Drag or swipe to spin it; it settles facing the nearest
 *    photo, and the thumbnails spin straight to one.
 *  - 1 photo: the photo is a 3D card that tilts toward the pointer.
 *  - no photos: the original emoji/brand-colour cube.
 */
export function Product3DViewer({ photos = [], ...rest }: Props) {
  const ring = photos.slice(0, MAX_RING_PHOTOS);
  if (ring.length >= 2) return <PhotoRing photos={ring} name={rest.name} discount={rest.discount} />;
  if (ring.length === 1) return <PhotoCard photo={ring[0]} name={rest.name} discount={rest.discount} />;
  return <FallbackCube {...rest} />;
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

const STAGE_BG = "radial-gradient(ellipse at 50% 35%, #FFFFFF 0%, #F4EFE3 55%, #E8E0CC 100%)";

function useStageWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth || 640);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function prefersReducedMotion() {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

function IconButton({ onClick, label, children }: { onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button onClick={onClick} className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50" aria-label={label} title={label}>
      {children}
    </button>
  );
}

function DiscountBadge({ discount }: { discount?: number }) {
  return discount ? <span className="absolute top-3 left-3 z-10 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-md">-{discount}%</span> : null;
}

// ─── 2+ photos: a spinning ring of the real product photos ───────────────────

function PhotoRing({ photos, name, discount }: { photos: string[]; name: string; discount?: number }) {
  const n = photos.length;
  const step = 360 / n;
  const [stageRef, stageWidth] = useStageWidth();
  // Panel size follows the stage so the front photo stays large on phones.
  const panel = Math.round(Math.max(170, Math.min(300, stageWidth * 0.46)));
  // Distance from the ring's centre to each panel so neighbours just touch,
  // plus a gap. Two photos would sit back-to-back: give them some depth.
  const radius = n === 2 ? panel * 0.55 : Math.round(panel / 2 / Math.tan(Math.PI / n) + panel * 0.12);

  const [rotY, setRotY] = useState(0);
  const [tilt, setTilt] = useState(-6);
  const [zoom, setZoom] = useState(1);
  const [autoRotate, setAutoRotate] = useState(() => !prefersReducedMotion());
  const [settling, setSettling] = useState(false);
  const dragging = useRef(false);
  const moved = useRef(0);
  const last = useRef({ x: 0, y: 0 });

  // Which photo is facing the shopper right now.
  const front = ((Math.round(-rotY / step) % n) + n) % n;

  useEffect(() => {
    if (!autoRotate) return;
    let raf: number;
    const tick = () => { setRotY(r => r - 0.25); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [autoRotate]);

  const spinTo = useCallback((i: number) => {
    setAutoRotate(false);
    setSettling(true);
    setRotY(r => {
      // Take the short way round from wherever the ring is now.
      const target = -i * step;
      const delta = ((((target - r) % 360) + 540) % 360) - 180;
      return r + delta;
    });
  }, [step]);

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    moved.current = 0;
    setAutoRotate(false);
    setSettling(false);
    last.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - last.current.x, dy = e.clientY - last.current.y;
    last.current = { x: e.clientX, y: e.clientY };
    moved.current += Math.abs(dx) + Math.abs(dy);
    setRotY(r => r + dx * 0.4);
    setTilt(t => Math.max(-22, Math.min(12, t - dy * 0.15)));
  };
  const onPointerUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    // Settle facing the nearest photo, so it ends on a clear straight-on view.
    setSettling(true);
    setRotY(r => Math.round(r / step) * step);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); spinTo((front - 1 + n) % n); }
    if (e.key === "ArrowRight") { e.preventDefault(); spinTo((front + 1) % n); }
  };

  const reset = () => { setSettling(true); setRotY(Math.round(rotY / 360) * 360); setTilt(-6); setZoom(1); };
  const stageHeight = Math.round(panel * 1.45);

  return (
    <div className="relative">
      <div
        ref={stageRef}
        role="group"
        tabIndex={0}
        aria-roledescription="3D photo viewer"
        aria-label={`${name}: 3D view, photo ${front + 1} of ${n}. Drag to rotate, or use the arrow keys.`}
        onKeyDown={onKeyDown}
        className="relative flex items-center justify-center touch-none select-none cursor-grab active:cursor-grabbing outline-none"
        style={{ height: stageHeight, background: STAGE_BG, perspective: Math.max(900, radius * 4), overflow: "hidden" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <DiscountBadge discount={discount} />
        {/* Floor shadow */}
        <div className="absolute rounded-full pointer-events-none"
          style={{ width: panel * 1.5 * zoom, height: panel * 0.22 * zoom, bottom: stageHeight * 0.08, background: "rgba(60,40,10,0.22)", filter: "blur(16px)" }} />
        <div
          style={{
            width: panel, height: panel,
            transformStyle: "preserve-3d",
            // Push the ring back by its radius so the front photo sits at the
            // stage plane (full size), then spin it.
            transform: `scale(${zoom}) translateZ(${-radius}px) rotateX(${tilt}deg) rotateY(${rotY}deg)`,
            transition: settling ? "transform 0.6s cubic-bezier(.2,.8,.2,1)" : "none",
          }}
          onTransitionEnd={() => setSettling(false)}
        >
          {photos.map((src, i) => {
            // How far this panel is turned away from the viewer (0 = facing).
            const away = Math.abs(((((i * step + rotY) % 360) + 540) % 360) - 180);
            const facing = 1 - away / 180;
            return (
              <div key={src + i}
                className="absolute inset-0 rounded-2xl bg-white overflow-hidden"
                style={{
                  transform: `rotateY(${i * step}deg) translateZ(${radius}px)`,
                  backfaceVisibility: "hidden",
                  boxShadow: "0 18px 40px -18px rgba(40,25,5,0.45), 0 0 0 1px rgba(0,0,0,0.05)",
                  filter: `brightness(${(0.72 + 0.28 * facing).toFixed(3)})`,
                }}
              >
                <img src={src} alt={i === front ? `${name} — photo ${i + 1}` : ""} draggable={false}
                  loading={i === 0 ? "eager" : "lazy"} className="w-full h-full object-contain p-3 pointer-events-none" />
              </div>
            );
          })}
        </div>

        <span className="absolute top-3 right-3 flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full bg-white/85 text-gray-600 pointer-events-none">
          <Box className="w-3 h-3" /> Drag to rotate
        </span>
        <span className="absolute bottom-3 right-3 text-[11px] font-bold px-2.5 py-1 rounded-full bg-black/35 text-white pointer-events-none">
          {front + 1} / {n}
        </span>
      </div>

      {/* Thumbnails spin the ring to that photo */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-white border-t border-gray-100 overflow-x-auto">
        {photos.map((src, i) => (
          <button key={src + i} onClick={() => spinTo(i)} aria-label={`Turn to photo ${i + 1}`} aria-current={i === front}
            className="shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-white transition-all"
            style={{ border: i === front ? "2px solid #B8862E" : "2px solid #F3F4F6", opacity: i === front ? 1 : 0.7 }}>
            <img src={src} alt="" loading="lazy" className="w-full h-full object-contain pointer-events-none" />
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-white border-t border-gray-100">
        <p className="text-[10px] text-gray-500 truncate">Real product photos, shown in 3D</p>
        <div className="flex items-center gap-1">
          <IconButton onClick={() => setAutoRotate(a => !a)} label={autoRotate ? "Pause rotation" : "Auto-rotate"}>
            {autoRotate ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </IconButton>
          <IconButton onClick={() => setZoom(z => Math.max(0.7, +(z - 0.15).toFixed(2)))} label="Zoom out"><ZoomOut className="w-3.5 h-3.5" /></IconButton>
          <IconButton onClick={() => setZoom(z => Math.min(1.6, +(z + 0.15).toFixed(2)))} label="Zoom in"><ZoomIn className="w-3.5 h-3.5" /></IconButton>
          <IconButton onClick={reset} label="Reset view"><RotateCcw className="w-3.5 h-3.5" /></IconButton>
        </div>
      </div>
    </div>
  );
}

// ─── 1 photo: a card that tilts in 3D ────────────────────────────────────────

function PhotoCard({ photo, name, discount }: { photo: string; name: string; discount?: number }) {
  const [rot, setRot] = useState({ x: -8, y: 18 });
  const [zoom, setZoom] = useState(1);
  const [autoRotate, setAutoRotate] = useState(() => !prefersReducedMotion());
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  // Gentle sway while idle.
  useEffect(() => {
    if (!autoRotate) return;
    let raf: number; const t0 = performance.now();
    const tick = (t: number) => {
      const s = (t - t0) / 1000;
      setRot({ x: -6 + Math.sin(s * 0.9) * 5, y: Math.sin(s * 0.6) * 28 });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [autoRotate]);

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true; setAutoRotate(false);
    last.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - last.current.x, dy = e.clientY - last.current.y;
    last.current = { x: e.clientX, y: e.clientY };
    setRot(r => ({ x: Math.max(-35, Math.min(35, r.x - dy * 0.35)), y: Math.max(-55, Math.min(55, r.y + dx * 0.35)) }));
  };
  const onPointerUp = () => { dragging.current = false; };

  const [stageRef, stageWidth] = useStageWidth();
  const card = Math.round(Math.max(220, Math.min(340, stageWidth * 0.6)));
  // Light sweeps across the card as it turns.
  const sheenX = 50 - rot.y * 1.2, sheenY = 50 + rot.x * 1.2;

  return (
    <div className="relative">
      <div ref={stageRef}
        className="relative flex items-center justify-center touch-none select-none cursor-grab active:cursor-grabbing"
        style={{ height: Math.round(card * 1.35), background: STAGE_BG, perspective: 1000, overflow: "hidden" }}
        aria-label={`${name}: 3D view. Drag to tilt.`} role="img"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <DiscountBadge discount={discount} />
        <div className="absolute rounded-full pointer-events-none"
          style={{ width: card * 1.1 * zoom, height: card * 0.16 * zoom, bottom: card * 0.08, background: "rgba(60,40,10,0.22)", filter: "blur(16px)",
            transform: `translateX(${rot.y * 0.8}px)` }} />
        <div className="relative rounded-2xl bg-white overflow-hidden"
          style={{ width: card, height: card, transform: `scale(${zoom}) rotateX(${rot.x}deg) rotateY(${rot.y}deg)`,
            boxShadow: `${-rot.y * 0.5}px ${24 + rot.x * 0.5}px 50px -20px rgba(40,25,5,0.5), 0 0 0 1px rgba(0,0,0,0.05)` }}>
          <img src={photo} alt={name} draggable={false} className="w-full h-full object-contain p-3 pointer-events-none" />
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: `radial-gradient(circle at ${sheenX}% ${sheenY}%, rgba(255,255,255,0.35), transparent 55%)` }} />
        </div>
        <span className="absolute top-3 right-3 flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full bg-white/85 text-gray-600 pointer-events-none">
          <Box className="w-3 h-3" /> Drag to tilt
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-white border-t border-gray-100">
        <p className="text-[10px] text-gray-500 truncate">Real product photo, shown in 3D</p>
        <div className="flex items-center gap-1">
          <IconButton onClick={() => setAutoRotate(a => !a)} label={autoRotate ? "Pause motion" : "Auto-rotate"}>
            {autoRotate ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </IconButton>
          <IconButton onClick={() => setZoom(z => Math.max(0.7, +(z - 0.15).toFixed(2)))} label="Zoom out"><ZoomOut className="w-3.5 h-3.5" /></IconButton>
          <IconButton onClick={() => setZoom(z => Math.min(1.5, +(z + 0.15).toFixed(2)))} label="Zoom in"><ZoomIn className="w-3.5 h-3.5" /></IconButton>
          <IconButton onClick={() => { setRot({ x: -8, y: 18 }); setZoom(1); }} label="Reset view"><RotateCcw className="w-3.5 h-3.5" /></IconButton>
        </div>
      </div>
    </div>
  );
}

// ─── No photos: the original emoji / brand-colour cube ───────────────────────

function FallbackCube({ emoji, colorA, colorB, brand, name, discount, illustration }: Omit<Props, "photos">) {
  const [mode, setMode] = useState<"3d" | "photo">("3d");
  const [rotX, setRotX] = useState(-14);
  const [rotY, setRotY] = useState(28);
  const [zoom, setZoom] = useState(1);
  const [autoRotate, setAutoRotate] = useState(true);
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!autoRotate || mode !== "3d") return;
    let raf: number;
    const tick = () => { setRotY(r => r + 0.35); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [autoRotate, mode]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    setAutoRotate(false);
    last.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - last.current.x, dy = e.clientY - last.current.y;
    last.current = { x: e.clientX, y: e.clientY };
    setRotY(r => r + dx * 0.5);
    setRotX(r => Math.max(-80, Math.min(80, r - dy * 0.5)));
  }, []);
  const onPointerUp = useCallback(() => { dragging.current = false; }, []);
  const reset = () => { setRotX(-14); setRotY(28); setZoom(1); setAutoRotate(true); };

  const faceStyle = (transform: string, shade: number): React.CSSProperties => ({
    position: "absolute", width: SIZE * 2, height: SIZE * 2, left: -SIZE, top: -SIZE,
    background: `linear-gradient(150deg, ${colorA} 0%, ${colorB} 100%)`,
    filter: `brightness(${shade})`, border: "1px solid rgba(255,255,255,0.15)",
    display: "flex", alignItems: "center", justifyContent: "center",
    transform, backfaceVisibility: "hidden", borderRadius: 12,
  });

  return (
    <div className="relative" style={{ minHeight: 340 }}>
      {mode === "photo" ? (
        <div className="flex items-center justify-center p-16" style={{ background: `linear-gradient(135deg,${colorA},${colorB})`, minHeight: 340 }}>
          {illustration ? <div className="w-40 h-40">{illustration()}</div> : <span className="text-9xl select-none">{emoji}</span>}
        </div>
      ) : (
        <div className="flex items-center justify-center touch-none select-none cursor-grab active:cursor-grabbing"
          style={{ minHeight: 340, background: "radial-gradient(circle at 50% 40%, #EAF7EE 0%, #E9E4FA 100%)", perspective: 900, overflow: "hidden" }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
          <div className="absolute rounded-full" style={{ width: SIZE * 1.7 * zoom, height: SIZE * 0.5 * zoom, background: "rgba(30,20,60,0.18)", filter: "blur(14px)", transform: "translateY(120px)" }} />
          <div style={{ width: SIZE * 2, height: SIZE * 2, transformStyle: "preserve-3d", transform: `scale(${zoom}) rotateX(${rotX}deg) rotateY(${rotY}deg)` }}>
            <div style={faceStyle(`translateZ(${SIZE}px)`, 1.08)}>
              {illustration
                ? <div className="w-32 h-32 pointer-events-none">{illustration()}</div>
                : <span className="text-8xl select-none pointer-events-none">{emoji}</span>}
              {Boolean(discount) && <span className="absolute top-4 left-4 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-md">-{discount}%</span>}
            </div>
            <div style={faceStyle(`rotateY(180deg) translateZ(${SIZE}px)`, 0.75)}>
              <span className="text-white/90 font-black text-lg tracking-wide -rotate-90">{brand.toUpperCase()}</span>
            </div>
            <div style={faceStyle(`rotateY(90deg) translateZ(${SIZE}px)`, 0.92)} />
            <div style={faceStyle(`rotateY(-90deg) translateZ(${SIZE}px)`, 0.92)} />
            <div style={faceStyle(`rotateX(90deg) translateZ(${SIZE}px)`, 1.2)} />
            <div style={faceStyle(`rotateX(-90deg) translateZ(${SIZE}px)`, 0.6)} />
          </div>
          <span className="absolute top-3 left-3 flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full bg-white/80 text-gray-600">
            <Box className="w-3 h-3" /> Drag to rotate
          </span>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-white border-t border-gray-100">
        <div className="flex items-center gap-1">
          <button onClick={() => setMode(m => (m === "3d" ? "photo" : "3d"))}
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50">
            {mode === "3d" ? <><ImageIcon className="w-3.5 h-3.5" /> Photo view</> : <><Box className="w-3.5 h-3.5" /> 3D view</>}
          </button>
          <p className="text-[10px] text-gray-400 hidden sm:block ml-1 max-w-[160px] truncate">{name}</p>
        </div>
        {mode === "3d" && (
          <div className="flex items-center gap-1">
            <IconButton onClick={() => setAutoRotate(a => !a)} label="Toggle auto-rotate">{autoRotate ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}</IconButton>
            <IconButton onClick={() => setZoom(z => Math.max(0.6, +(z - 0.15).toFixed(2)))} label="Zoom out"><ZoomOut className="w-3.5 h-3.5" /></IconButton>
            <IconButton onClick={() => setZoom(z => Math.min(1.6, +(z + 0.15).toFixed(2)))} label="Zoom in"><ZoomIn className="w-3.5 h-3.5" /></IconButton>
            <IconButton onClick={reset} label="Reset view"><RotateCcw className="w-3.5 h-3.5" /></IconButton>
          </div>
        )}
      </div>
    </div>
  );
}
