// Original flat-style vehicle illustrations, drawn as SVG shape
// compositions (not traced or derived from any photograph, and depicting
// no real make/model design) — a generic cartoon side-view silhouette per
// body type, used for the Vehicles department in place of the plain
// emoji placeholder or an actual vehicle photo Ballylife doesn't own.

const BODY = "#2563EB";
const BODY_DARK = "#1D4ED8";
const WINDOW = "#BFDBFE";
const WHEEL = "#1F2937";
const HUBCAP = "#D1D5DB";
const ACCENT = "#FBBF24";

function Wheels({ positions }: { positions: [number, number][] }) {
  return (
    <>
      {positions.map(([cx, cy], i) => (
        <g key={i}>
          <circle cx={cx} cy={cy} r="13" fill={WHEEL} />
          <circle cx={cx} cy={cy} r="6" fill={HUBCAP} />
        </g>
      ))}
    </>
  );
}

export function SedanIllustration() {
  return (
    <svg viewBox="0 0 160 100" className="w-full h-full">
      <path d="M14 78 Q10 78 10 70 L14 56 Q18 44 34 40 L48 28 Q56 22 70 22 L102 22 Q114 22 120 30 L132 42 Q150 44 150 60 L150 70 Q150 78 144 78 Z" fill={BODY} />
      <path d="M50 40 L58 28 Q64 24 72 24 L98 24 Q106 24 112 30 L120 40 Z" fill={WINDOW} opacity="0.9" />
      <line x1="86" y1="24" x2="86" y2="40" stroke={BODY_DARK} strokeWidth="2.5" />
      <rect x="14" y="70" width="132" height="8" fill={BODY_DARK} opacity="0.4" />
      <rect x="8" y="58" width="8" height="6" rx="2" fill={ACCENT} />
      <rect x="144" y="58" width="8" height="6" rx="2" fill={ACCENT} />
      <Wheels positions={[[42, 78], [122, 78]]} />
    </svg>
  );
}

export function HatchbackIllustration() {
  return (
    <svg viewBox="0 0 160 100" className="w-full h-full">
      <path d="M16 78 Q12 78 12 70 L16 56 Q20 42 38 38 L52 26 Q60 20 72 20 L110 20 Q126 20 132 34 L138 44 Q148 46 148 62 L148 70 Q148 78 142 78 Z" fill={BODY} />
      <path d="M54 38 L62 26 Q66 22 74 22 L106 22 Q116 22 122 32 L128 42 Z" fill={WINDOW} opacity="0.9" />
      <line x1="94" y1="22" x2="94" y2="42" stroke={BODY_DARK} strokeWidth="2.5" />
      <rect x="16" y="70" width="132" height="8" fill={BODY_DARK} opacity="0.4" />
      <rect x="10" y="58" width="8" height="6" rx="2" fill={ACCENT} />
      <rect x="142" y="58" width="8" height="6" rx="2" fill={ACCENT} />
      <Wheels positions={[[44, 78], [120, 78]]} />
    </svg>
  );
}

export function SuvIllustration() {
  return (
    <svg viewBox="0 0 160 100" className="w-full h-full">
      <path d="M12 76 Q8 76 8 66 L12 48 Q16 32 36 28 L48 18 Q56 12 70 12 L112 12 Q124 12 130 22 L138 34 Q152 36 152 56 L152 66 Q152 76 146 76 Z" fill={BODY} />
      <path d="M50 28 L58 18 Q64 14 72 14 L100 14 Q108 14 114 20 L122 28 Z" fill={WINDOW} opacity="0.9" />
      <path d="M126 28 L134 34 Q140 38 140 44 L140 50 L128 50 Z" fill={WINDOW} opacity="0.7" />
      <line x1="88" y1="14" x2="88" y2="50" stroke={BODY_DARK} strokeWidth="2.5" />
      <rect x="12" y="66" width="140" height="10" fill={BODY_DARK} opacity="0.4" />
      <Wheels positions={[[40, 76], [124, 76]]} />
    </svg>
  );
}

export function VanIllustration() {
  return (
    <svg viewBox="0 0 160 100" className="w-full h-full">
      <path d="M10 76 Q6 76 6 66 L8 50 Q10 34 28 30 L34 22 Q40 16 52 16 L128 16 Q142 16 148 30 L150 50 Q154 52 154 62 L154 66 Q154 76 148 76 Z" fill={BODY} />
      <path d="M36 30 L40 24 Q44 20 52 20 L62 20 L62 40 L34 40 Z" fill={WINDOW} opacity="0.9" />
      <rect x="70" y="24" width="72" height="30" rx="3" fill={BODY_DARK} opacity="0.25" />
      <rect x="12" y="66" width="142" height="10" fill={BODY_DARK} opacity="0.4" />
      <Wheels positions={[[38, 76], [126, 76]]} />
    </svg>
  );
}

// body_type from mkt_products.vehicle_details -> illustration component.
export const VEHICLE_ILLUSTRATIONS: Record<string, () => import("react").ReactNode> = {
  sedan: SedanIllustration,
  hatchback: HatchbackIllustration,
  station_wagon: HatchbackIllustration,
  suv: SuvIllustration,
  pickup_single_cab: VanIllustration,
  pickup_double_cab: VanIllustration,
  panel_van: VanIllustration,
};
