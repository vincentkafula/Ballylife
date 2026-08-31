const BG       = "#0B2E1C";
const DARK_BAR = "#1A0F4A";
const CARD_BG  = "#5B21B6";
const LINK_HL  = "#00BFFF";

const COLS = [
  {
    title: "Shop",
    links: [
      "All Categories",
      "Today's Deals",
      "New Arrivals",
      "Track My Order",
      "Returns & Refunds",
    ],
  },
  {
    title: "Sell on Ballylife",
    links: [
      "Become a Seller",
      "Seller Dashboard",
      "Seller Help Centre",
      "Fees & Commission",
    ],
  },
  {
    title: "Company",
    links: [
      "About Ballylife",
      "Careers",
      "Contact Us",
    ],
  },
  {
    title: "Legal",
    links: [
      "Terms of Use",
      "Privacy Statement",
      "Returns Policy",
    ],
  },
  {
    title: "Support",
    links: [
      "Help Centre",
      "Send Feedback",
    ],
  },
];

const SOCIALS = [
  {
    label: "Facebook",
    icon: (
      <svg viewBox="0 0 24 24" width="15" height="15" fill="white">
        <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
      </svg>
    ),
  },
  {
    label: "Twitter",
    icon: (
      <svg viewBox="0 0 24 24" width="15" height="15" fill="white">
        <path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z" />
      </svg>
    ),
  },
  {
    label: "Instagram",
    icon: (
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="white" strokeWidth="2">
        <rect x="2" y="2" width="20" height="20" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="1" fill="white" stroke="none" />
      </svg>
    ),
  },
];

function LinkColumn({ title, links, onLinkClick }: { title: string; links: string[]; onLinkClick?: (label: string) => void }) {
  return (
    <div>
      {/* Column heading with accent underline */}
      <div style={{ marginBottom: 18 }}>
        <p style={{ color: "#fff", fontSize: 16, fontWeight: 700, lineHeight: "22px", letterSpacing: "0.01em" }}>
          {title}
        </p>
        <div style={{ width: 28, height: 2, background: LINK_HL, borderRadius: 2, marginTop: 6 }} />
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {links.map((l) => (
          <li key={l}>
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); onLinkClick?.(l); }}
              style={{ color: "rgba(255,255,255,0.68)", fontSize: 14, lineHeight: "20px", textDecoration: "none", display: "block" }}
              onMouseEnter={(e) => { (e.target as HTMLAnchorElement).style.color = "#fff"; (e.target as HTMLAnchorElement).style.paddingLeft = "4px"; }}
              onMouseLeave={(e) => { (e.target as HTMLAnchorElement).style.color = "rgba(255,255,255,0.68)"; (e.target as HTMLAnchorElement).style.paddingLeft = "0"; }}
            >
              {l}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Footer({ onLinkClick }: { onLinkClick?: (label: string) => void }) {
  // Falls back to a global CustomEvent when no explicit handler is passed,
  // so pages that render Footer don't all need to prop-drill a handler
  // through from App.tsx.
  const handleLinkClick = onLinkClick ?? ((label: string) => {
    window.dispatchEvent(new CustomEvent("ballylife:footer-link", { detail: { label } }));
  });
  return (
    <footer style={{ background: BG, fontFamily: "'Inter','Roboto',sans-serif" }}>

      {/* ── SECTION 1: Main columns ─────────────────────────────────────────── */}
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "64px 40px 56px" }}>

        {/* Top strip: wordmark + social */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 20, marginBottom: 48, paddingBottom: 32, borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
          <p style={{ color: "#fff", fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", margin: 0 }}>Ballylife</p>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
            <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", margin: 0 }}>
              Follow Us
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              {SOCIALS.map((s) => (
                <a
                  key={s.label}
                  href="#"
                  title={s.label}
                  style={{
                    width: 34, height: 34, borderRadius: "50%",
                    background: "rgba(255,255,255,0.12)",
                    border: "1px solid rgba(255,255,255,0.18)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "background 0.2s",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = CARD_BG; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = "rgba(255,255,255,0.12)"; }}
                >
                  {s.icon}
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* Link columns + download card */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "40px 32px" }}>
          <LinkColumn title={COLS[0].title} links={COLS[0].links} onLinkClick={handleLinkClick} />
          <LinkColumn title={COLS[1].title} links={COLS[1].links} onLinkClick={handleLinkClick} />

          <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
            <LinkColumn title={COLS[2].title} links={COLS[2].links} onLinkClick={handleLinkClick} />
            <LinkColumn title={COLS[3].title} links={COLS[3].links} onLinkClick={handleLinkClick} />
          </div>

          <LinkColumn title={COLS[4].title} links={COLS[4].links} onLinkClick={handleLinkClick} />

          {/* ── Download apps ────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {/* App Store -- Coming Soon: not yet published */}
            <div style={{
              display: "flex", alignItems: "center", gap: 12,
              background: "linear-gradient(180deg,#1a1a1a,#000)", borderRadius: 10,
              padding: "11px 18px",
              border: "1px solid rgba(255,255,255,0.15)",
              opacity: 0.55,
            }}>
              <svg viewBox="0 0 24 24" width="24" height="24" fill="white">
                <path d="M17.05 12.5c-.03-2.4 1.96-3.56 2.05-3.61-1.12-1.63-2.86-1.86-3.48-1.88-1.48-.15-2.89.87-3.64.87-.75 0-1.9-.85-3.13-.83-1.6.02-3.09.94-3.92 2.38-1.68 2.9-.43 7.19 1.2 9.55.8 1.15 1.75 2.45 3 2.4 1.21-.05 1.66-.78 3.12-.78 1.46 0 1.87.78 3.15.75 1.3-.02 2.13-1.17 2.92-2.32.92-1.33 1.3-2.62 1.32-2.69-.03-.01-2.53-.97-2.56-3.84h-.03z"/>
                <path d="M14.7 5.42c.66-.8 1.11-1.92 .99-3.03-.95.04-2.11.63-2.8 1.43-.61.7-1.15 1.86-1 2.94 1.06.08 2.15-.53 2.81-1.34z"/>
              </svg>
              <div>
                <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 9.5, lineHeight: 1, margin: 0, letterSpacing: "0.06em" }}>App Store</p>
                <p style={{ color: "#fff", fontSize: 15, fontWeight: 600, lineHeight: "20px", margin: "3px 0 0", letterSpacing: "-0.01em" }}>Coming Soon</p>
              </div>
            </div>

            {/* Google Play -- Coming Soon: not yet published */}
            <div style={{
              display: "flex", alignItems: "center", gap: 12,
              background: "linear-gradient(180deg,#1a1a1a,#000)", borderRadius: 10,
              padding: "11px 18px",
              border: "1px solid rgba(255,255,255,0.15)",
              opacity: 0.55,
            }}>
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none">
                <path d="M3 3L13.5 12 3 21V3Z"           fill="#EA4335" />
                <path d="M3 3L13.5 12 21 7.5 7.5 1 3 3Z" fill="#FBBC04" />
                <path d="M3 21L13.5 12 21 16.5 7.5 23 3 21Z" fill="#34A853" />
                <path d="M13.5 12L21 7.5V16.5L13.5 12Z"  fill="#4285F4" />
              </svg>
              <div>
                <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 9.5, lineHeight: 1, margin: 0, letterSpacing: "0.06em" }}>Google Play</p>
                <p style={{ color: "#fff", fontSize: 15, fontWeight: 600, lineHeight: "20px", margin: "3px 0 0", letterSpacing: "-0.01em" }}>Coming Soon</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── SECTION 2: Dark bottom bar ──────────────────────────────────────── */}
      <div style={{ background: DARK_BAR }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 40px" }}>
          {/* Legal links row */}
          <div style={{ height: 56, display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: "6px 0" }}>
            {["Terms Of Use", "Privacy Statement"].map((item, i, arr) => (
              <span key={item} style={{ display: "flex", alignItems: "center" }}>
                <a href="#" onClick={(e) => { e.preventDefault(); handleLinkClick(item); }} style={{ color: "rgba(255,255,255,0.55)", fontSize: 12, fontWeight: 700, textDecoration: "none", padding: "0 12px", whiteSpace: "nowrap" }}
                  onMouseEnter={(e) => { (e.target as HTMLAnchorElement).style.color = "#fff"; }}
                  onMouseLeave={(e) => { (e.target as HTMLAnchorElement).style.color = "rgba(255,255,255,0.55)"; }}
                >
                  {item}
                </a>
                {i < arr.length - 1 && (
                  <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 12 }}>|</span>
                )}
              </span>
            ))}
          </div>
          {/* Copyright */}
          <div style={{ paddingBottom: 16, textAlign: "center" }}>
            <p style={{ color: "rgba(255,255,255,0.28)", fontSize: 12, margin: 0 }}>
              © Copyright Ballylife. All Rights Reserved.
            </p>
          </div>
        </div>
      </div>

    </footer>
  );
}
