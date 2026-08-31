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
}

const SIZE = 180; // half-extent of the cube in px (face size = SIZE)

/**
 * Renders the product as a draggable, auto-rotating 3D cube using pure CSS
 * 3D transforms (perspective + preserve-3d) — no WebGL/GLTF asset pipeline
 * needed, since there are no real product meshes to load. Every face is
 * built from the product's own emoji + brand colours, so it stays accurate
 * to the actual listing instead of a generic placeholder shape.
 */
export function Product3DViewer({ emoji, colorA, colorB, brand, name, discount, illustration }: Props) {
  const [mode, setMode] = useState<"3d" | "photo">("3d");
  const [rotX, setRotX] = useState(-14);
  const [rotY, setRotY] = useState(28);
  const [zoom, setZoom] = useState(1);
  const [autoRotate, setAutoRotate] = useState(true);
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const velocity = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-rotate loop
  useEffect(() => {
    if (!autoRotate || mode !== "3d") return;
    let raf: number;
    const tick = () => {
      setRotY(r => r + 0.35);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [autoRotate, mode]);

  // Momentum decay after a drag release
  useEffect(() => {
    if (dragging.current || autoRotate) return;
    if (Math.abs(velocity.current.x) < 0.02 && Math.abs(velocity.current.y) < 0.02) return;
    let raf: number;
    const tick = () => {
      velocity.current.x *= 0.94;
      velocity.current.y *= 0.94;
      setRotY(r => r + velocity.current.x);
      setRotX(r => Math.max(-80, Math.min(80, r + velocity.current.y)));
      if (Math.abs(velocity.current.x) > 0.02 || Math.abs(velocity.current.y) > 0.02) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotX, rotY]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    setAutoRotate(false);
    last.current = { x: e.clientX, y: e.clientY };
    velocity.current = { x: 0, y: 0 };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - last.current.x;
    const dy = e.clientY - last.current.y;
    last.current = { x: e.clientX, y: e.clientY };
    velocity.current = { x: dx * 0.5, y: -dy * 0.5 };
    setRotY(r => r + dx * 0.5);
    setRotX(r => Math.max(-80, Math.min(80, r - dy * 0.5)));
  }, []);

  const onPointerUp = useCallback(() => { dragging.current = false; }, []);

  const reset = () => { setRotX(-14); setRotY(28); setZoom(1); setAutoRotate(true); };

  const faceStyle = (transform: string, shade: number): React.CSSProperties => ({
    position: "absolute",
    width: SIZE * 2,
    height: SIZE * 2,
    left: -SIZE, top: -SIZE,
    background: `linear-gradient(150deg, ${colorA} 0%, ${colorB} 100%)`,
    filter: `brightness(${shade})`,
    border: "1px solid rgba(255,255,255,0.15)",
    display: "flex", alignItems: "center", justifyContent: "center",
    transform,
    backfaceVisibility: "hidden",
    borderRadius: 12,
  });

  return (
    <div className="relative" style={{ minHeight: 340 }}>
      {mode === "photo" ? (
        <div className="flex items-center justify-center p-16" style={{ background: `linear-gradient(135deg,${colorA},${colorB})`, minHeight: 340 }}>
          {illustration ? <div className="w-40 h-40">{illustration()}</div> : <span className="text-9xl select-none">{emoji}</span>}
        </div>
      ) : (
        <div
          ref={containerRef}
          className="flex items-center justify-center touch-none select-none cursor-grab active:cursor-grabbing"
          style={{ minHeight: 340, background: "radial-gradient(circle at 50% 40%, #EAF7EE 0%, #E9E4FA 100%)", perspective: 900, overflow: "hidden" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          {/* Ground shadow */}
          <div
            className="absolute rounded-full"
            style={{ width: SIZE * 1.7 * zoom, height: SIZE * 0.5 * zoom, background: "rgba(30,20,60,0.18)", filter: "blur(14px)", transform: "translateY(120px)" }}
          />
          <div
            style={{
              width: SIZE * 2, height: SIZE * 2,
              transformStyle: "preserve-3d",
              transform: `scale(${zoom}) rotateX(${rotX}deg) rotateY(${rotY}deg)`,
              transition: dragging.current ? "none" : "transform 0.05s linear",
            }}
          >
            <div style={faceStyle(`translateZ(${SIZE}px)`, 1.08)}>
              {illustration
                ? <div className="w-32 h-32 pointer-events-none" style={{ transform: "translateZ(1px)" }}>{illustration()}</div>
                : <span className="text-8xl select-none pointer-events-none" style={{ transform: "translateZ(1px)" }}>{emoji}</span>}
              {Boolean(discount) && (
                <span className="absolute top-4 left-4 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-md">-{discount}%</span>
              )}
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

      {/* Controls */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-white border-t border-gray-100">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMode(m => (m === "3d" ? "photo" : "3d"))}
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
          >
            {mode === "3d" ? <><ImageIcon className="w-3.5 h-3.5" /> Photo view</> : <><Box className="w-3.5 h-3.5" /> 3D view</>}
          </button>
          <p className="text-[10px] text-gray-400 hidden sm:block ml-1 max-w-[160px] truncate">{name}</p>
        </div>

        {mode === "3d" && (
          <div className="flex items-center gap-1">
            <button onClick={() => setAutoRotate(a => !a)} className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50" aria-label="Toggle auto-rotate">
              {autoRotate ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            </button>
            <button onClick={() => setZoom(z => Math.max(0.6, +(z - 0.15).toFixed(2)))} className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50" aria-label="Zoom out">
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setZoom(z => Math.min(1.6, +(z + 0.15).toFixed(2)))} className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50" aria-label="Zoom in">
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button onClick={reset} className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50" aria-label="Reset view">
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
