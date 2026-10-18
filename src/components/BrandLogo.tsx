import type { CSSProperties } from "react";
import logo1x from "../imports/ballylife-logo-wide-1x.png";
import logo2x from "../imports/ballylife-logo-wide-2x.png";
import logo3x from "../imports/ballylife-logo-wide-3x.png";

/**
 * The Ballylife logo as a transparent PNG, so only the page's own background
 * shows behind it. Three pre-sized files (56/112/168 px tall, monogram beside the wordmark) let the browser
 * pick the one matching the screen's pixel density instead of squeezing one
 * large image down to ~60px, which is what made it look soft and muddy on
 * ordinary desktop screens.
 */
export function BrandLogo({ className, style, alt = "Ballylife" }: { className?: string; style?: CSSProperties; alt?: string }) {
  return <img src={logo1x} srcSet={`${logo1x} 1x, ${logo2x} 2x, ${logo3x} 3x`} alt={alt} className={className} style={style} />;
}
