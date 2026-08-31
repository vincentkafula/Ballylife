// Original flat-style chair illustrations, drawn as SVG shape compositions
// (not traced or derived from any photograph). Built specifically for the
// 7 generic, unbranded office chair listings in the marketplace, replacing
// the plain emoji placeholder with something that actually depicts the
// product's silhouette while staying entirely original artwork.

const INK = "#2D2540";
const SEAT = "#5B21B6";
const SEAT_DARK = "#4C1D95";
const ACCENT = "#F5A623";
const CHROME = "#B8B4C4";

function Base({ style = "star" }: { style?: "star" | "sled" | "stool" }) {
  if (style === "sled") {
    return (
      <g stroke={CHROME} strokeWidth="3" strokeLinecap="round" fill="none">
        <path d="M20 92 Q30 100 44 100 L96 100 Q110 100 120 92" />
        <path d="M28 100 L28 108" />
        <path d="M112 100 L112 108" />
      </g>
    );
  }
  if (style === "stool") {
    return (
      <g stroke={CHROME} strokeWidth="3" strokeLinecap="round" fill="none">
        <line x1="70" y1="78" x2="70" y2="112" />
        <circle cx="70" cy="80" r="14" opacity="0.5" />
        <path d="M50 118 L60 112 M90 118 L80 112 M70 122 L70 112 M52 108 L62 102 M88 108 L78 102" />
      </g>
    );
  }
  return (
    <g stroke={CHROME} strokeWidth="3" strokeLinecap="round" fill="none">
      <line x1="70" y1="82" x2="70" y2="100" />
      <path d="M70 100 L38 118 M70 100 L102 118 M70 100 L70 122 M70 100 L48 96 M70 100 L92 96" />
      <circle cx="38" cy="118" r="3" fill={CHROME} stroke="none" />
      <circle cx="102" cy="118" r="3" fill={CHROME} stroke="none" />
      <circle cx="70" cy="122" r="3" fill={CHROME} stroke="none" />
      <circle cx="48" cy="96" r="3" fill={CHROME} stroke="none" />
      <circle cx="92" cy="96" r="3" fill={CHROME} stroke="none" />
    </g>
  );
}

export function ExecutiveChairIllustration() {
  return (
    <svg viewBox="0 0 140 140" className="w-full h-full">
      <rect x="34" y="10" width="46" height="66" rx="14" fill={SEAT_DARK} />
      <rect x="40" y="18" width="34" height="46" rx="8" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="2" />
      <rect x="26" y="72" width="62" height="18" rx="9" fill={SEAT} />
      <path d="M18 60 Q10 60 10 68 L10 78" stroke={SEAT_DARK} strokeWidth="7" strokeLinecap="round" fill="none" />
      <path d="M96 60 Q104 60 104 68 L104 78" stroke={SEAT_DARK} strokeWidth="7" strokeLinecap="round" fill="none" />
      <Base style="star" />
    </svg>
  );
}

export function MeshTaskChairIllustration() {
  return (
    <svg viewBox="0 0 140 140" className="w-full h-full">
      <rect x="38" y="14" width="38" height="58" rx="12" fill="none" stroke={INK} strokeWidth="3" opacity="0.85" />
      {[22, 30, 38, 46, 54, 62].map(y => (
        <line key={y} x1="42" y1={y} x2="72" y2={y} stroke={SEAT} strokeWidth="2" opacity="0.55" />
      ))}
      <rect x="28" y="76" width="56" height="16" rx="8" fill={SEAT} />
      <path d="M20 66 Q13 66 13 74 L13 82" stroke={INK} strokeWidth="6" strokeLinecap="round" fill="none" opacity="0.7" />
      <path d="M92 66 Q99 66 99 74 L99 82" stroke={INK} strokeWidth="6" strokeLinecap="round" fill="none" opacity="0.7" />
      <Base style="star" />
    </svg>
  );
}

export function ManagerChairIllustration() {
  return (
    <svg viewBox="0 0 140 140" className="w-full h-full">
      <rect x="36" y="22" width="42" height="50" rx="16" fill={SEAT_DARK} />
      <rect x="28" y="74" width="58" height="17" rx="8.5" fill={SEAT} />
      <path d="M20 62 Q12 62 12 70 L12 80" stroke={SEAT_DARK} strokeWidth="6.5" strokeLinecap="round" fill="none" />
      <path d="M94 62 Q102 62 102 70 L102 80" stroke={SEAT_DARK} strokeWidth="6.5" strokeLinecap="round" fill="none" />
      <Base style="star" />
    </svg>
  );
}

export function ConferenceChairIllustration() {
  return (
    <svg viewBox="0 0 140 140" className="w-full h-full">
      <rect x="40" y="24" width="36" height="46" rx="10" fill={INK} opacity="0.85" />
      <rect x="30" y="72" width="56" height="15" rx="7.5" fill={SEAT} />
      <path d="M22 60 L22 82" stroke={CHROME} strokeWidth="5" strokeLinecap="round" />
      <path d="M94 60 L94 82" stroke={CHROME} strokeWidth="5" strokeLinecap="round" />
      <path d="M20 100 Q35 108 70 108 Q105 108 120 100" stroke={CHROME} strokeWidth="4" strokeLinecap="round" fill="none" />
      <line x1="30" y1="87" x2="26" y2="100" stroke={CHROME} strokeWidth="4" strokeLinecap="round" />
      <line x1="86" y1="87" x2="90" y2="100" stroke={CHROME} strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function DraftingStoolIllustration() {
  return (
    <svg viewBox="0 0 140 140" className="w-full h-full">
      <ellipse cx="70" cy="38" rx="26" ry="10" fill={SEAT} />
      <rect x="44" y="34" width="52" height="10" rx="5" fill={SEAT_DARK} />
      <Base style="stool" />
    </svg>
  );
}

export function VisitorChairIllustration() {
  return (
    <svg viewBox="0 0 140 140" className="w-full h-full">
      <rect x="42" y="26" width="34" height="44" rx="8" fill={SEAT} />
      <rect x="34" y="70" width="50" height="15" rx="7.5" fill={SEAT_DARK} />
      <Base style="sled" />
    </svg>
  );
}

export function GamingChairIllustration() {
  return (
    <svg viewBox="0 0 140 140" className="w-full h-full">
      <path d="M32 10 Q30 46 36 74 L82 74 Q88 46 86 10 Q59 4 32 10 Z" fill={INK} />
      <path d="M40 14 Q38 44 43 70 L75 70 Q80 44 78 14 Q59 9 40 14 Z" fill="none" stroke={ACCENT} strokeWidth="2.5" opacity="0.85" />
      <rect x="26" y="76" width="62" height="16" rx="8" fill={INK} />
      <rect x="26" y="76" width="62" height="16" rx="8" fill="none" stroke={ACCENT} strokeWidth="2" opacity="0.7" />
      <path d="M18 62 Q10 62 10 70 L10 80" stroke={INK} strokeWidth="7" strokeLinecap="round" fill="none" />
      <path d="M100 62 Q108 62 108 70 L108 80" stroke={INK} strokeWidth="7" strokeLinecap="round" fill="none" />
      <Base style="star" />
    </svg>
  );
}
