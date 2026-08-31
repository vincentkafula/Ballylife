import { useState, useRef, useCallback } from "react";
import { X, RotateCcw } from "lucide-react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  image: string;
  name: string;
}

/**
 * A physical card is a flat object, not a cube — a rotating-cube treatment
 * (like Product3DViewer, built for boxed marketplace goods) wouldn't read
 * as a real card. Instead this tracks the cursor and tilts the card in
 * perspective space (rotateX/rotateY), with a glossy highlight that sweeps
 * across the surface as it tilts — the same "hold it and turn it in the
 * light" interaction used for premium card reveals elsewhere (Apple Card,
 * most banking apps' own card art).
 */
export function Card3DViewer({ isOpen, onClose, image, name }: Props) {
  const [rotate, setRotate] = useState({ x: 0, y: 0 });
  const [glow, setGlow] = useState({ x: 50, y: 50 });
  const cardRef = useRef<HTMLDivElement>(null);

  const handleMove = useCallback((clientX: number, clientY: number) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (clientX - rect.left) / rect.width;   // 0..1 across the card
    const py = (clientY - rect.top) / rect.height;   // 0..1 down the card
    const maxTilt = 14;
    setRotate({
      x: (0.5 - py) * maxTilt * 2,   // tilt up/down
      y: (px - 0.5) * maxTilt * 2,   // tilt left/right
    });
    setGlow({ x: px * 100, y: py * 100 });
  }, []);

  const reset = useCallback(() => {
    setRotate({ x: 0, y: 0 });
    setGlow({ x: 50, y: 50 });
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center p-6"
      style={{ background: "rgba(10,5,20,0.92)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <button onClick={onClose}
        className="absolute top-5 right-5 w-10 h-10 rounded-full flex items-center justify-center text-white transition-colors hover:bg-white/15"
        style={{ background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.15)" }}
        aria-label="Close">
        <X className="w-5 h-5" />
      </button>

      <div style={{ perspective: 1400 }} onClick={e => e.stopPropagation()}>
        <div
          ref={cardRef}
          onMouseMove={e => handleMove(e.clientX, e.clientY)}
          onMouseLeave={reset}
          onTouchMove={e => { const t = e.touches[0]; if (t) handleMove(t.clientX, t.clientY); }}
          onTouchEnd={reset}
          className="relative rounded-2xl overflow-hidden cursor-grab active:cursor-grabbing select-none"
          style={{
            width: "min(88vw, 460px)",
            transform: `rotateX(${rotate.x}deg) rotateY(${rotate.y}deg)`,
            transition: "transform 0.15s ease-out",
            transformStyle: "preserve-3d",
            boxShadow: `${-rotate.y * 1.6}px ${rotate.x * 1.6 + 30}px 60px -12px rgba(0,0,0,0.55)`,
          }}
        >
          <img src={image} alt={`${name} — physical card design`} className="w-full h-auto block" draggable={false} />
          {/* Glossy highlight that follows the cursor, giving the tilt a reflective, physical-metal feel */}
          <div className="absolute inset-0 pointer-events-none"
            style={{
              background: `radial-gradient(circle at ${glow.x}% ${glow.y}%, rgba(255,255,255,0.35), transparent 45%)`,
              mixBlendMode: "overlay",
            }} />
        </div>
      </div>

      <div className="mt-8 flex flex-col items-center gap-3">
        <p className="text-white/70 text-sm font-medium">{name}</p>
        <button onClick={reset}
          className="inline-flex items-center gap-2 text-xs font-semibold text-white/60 hover:text-white transition-colors">
          <RotateCcw className="w-3.5 h-3.5" /> Reset view
        </button>
        <p className="text-white/35 text-[11px]">Move your cursor over the card to tilt it</p>
      </div>
    </div>
  );
}
