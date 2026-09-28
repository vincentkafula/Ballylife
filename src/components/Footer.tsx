import ballylifeLogo from "../imports/ballylife-logo-compact.png";

const BG      = "#F5F6F8";
const HEADING = "#211C16";
const LINK    = "#6B5A3E";
const BAR_BLUE = "#1E7B4D";

const COLS = [
  {
    title: "Shop",
    links: ["Deals", "ALOT For Less", "Clearance Sale", "Gift Vouchers", "Ballylife Deals"],
  },
  {
    title: "Account",
    links: ["My Account", "Track Order", "Returns", "Invoices", "Ballylife", "Coupons", "Personal Details"],
  },
  {
    title: "Help",
    links: ["Help Centre", "Contact Us", "Returns", "Submit an Idea", "Suggest a Product", "Shipping & Delivery", "Ballylife Pickup Points", "Log Intellectual Property Complaint"],
  },
  {
    title: "Company",
    links: ["About Us", "Careers", "Sell on Ballylife", "Deliver for Ballylife", "Press & News", "Competitions", "Ballylife for Business", "Ballylife.credit"],
  },
  {
    title: "Terms and Policies",
    links: ["Platform Terms", "Returns Policy", "Privacy Policy", "BallylifeMORE Terms", "Ballylife for Business Terms", "Ballylife.credit Terms", "Responsible Disclosure Policy", "Human Rights Statement", "Speak Up Process", "Code of Advertising Practice"],
  },
];

const CATEGORY_LINKS = [
  "Automotive", "Baby & Toddler", "Beauty", "Books", "Cameras", "Camping & Outdoors",
  "Cellphones & Wearables", "Computers & Tablets", "DIY Tools & Machinery", "Fashion", "Gaming",
  "Garden, Pool & Patio", "Health", "Home & Kitchen", "Household, Food & Beverages", "Liquor",
  "Luggage & Travel", "Movies & Series", "Music", "Office & Stationery", "Pets", "Sport",
  "TV, Audio & Video", "Toys", "Vouchers",
];

// Ballylife's real accounts. Each can be changed (or a new one switched on)
// with a VITE_SOCIAL_* variable on the frontend service; an icon without a
// link isn't shown, so there are never dead "#" links.
const env = import.meta.env as Record<string, string | undefined>;
const link = (name: string, fallback = "") => (env[name] ?? fallback).trim();
const SOCIALS = [
  { label: "Facebook", href: link("VITE_SOCIAL_FACEBOOK", "https://www.facebook.com/180824328440183"), bg: "#1877F2", icon: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="white"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" /></svg>
  ) },
  { label: "Instagram", href: link("VITE_SOCIAL_INSTAGRAM", "https://www.instagram.com/ballylifeonline/"), bg: "linear-gradient(45deg,#F58529,#DD2A7B,#8134AF,#515BD4)", icon: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="white" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="white" stroke="none" /></svg>
  ) },
  { label: "Threads", href: link("VITE_SOCIAL_THREADS", "https://www.threads.net/@ballylifeonline"), bg: "#000000", icon: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="white"><path d="M16.3 11.2c-.1 0-.2-.1-.3-.1-.2-2.8-1.7-4.4-4.3-4.4-1.5 0-2.8.7-3.6 1.9l1.4 1c.6-.9 1.5-1.1 2.2-1.1.9 0 1.5.3 1.9.8.3.4.5.9.6 1.5-.8-.1-1.6-.2-2.5-.1-2.5.1-4.1 1.6-4 3.6.1 1 .6 1.9 1.4 2.4.7.5 1.6.7 2.6.6 1.3-.1 2.3-.5 3-1.4.5-.7.9-1.6 1-2.7.6.4 1.1.9 1.3 1.5.4 1 .4 2.6-.9 3.9-1.2 1.2-2.6 1.7-4.7 1.7-2.4 0-4.2-.8-5.3-2.3-1.1-1.4-1.6-3.4-1.7-6 .1-2.6.6-4.6 1.7-6 1.2-1.5 3-2.3 5.3-2.3 2.4 0 4.2.8 5.4 2.3.6.7 1 1.7 1.3 2.8l1.7-.4c-.3-1.3-.8-2.5-1.6-3.4C17.5 2.7 15.2 1.7 12.3 1.7h-.1C9.3 1.7 7.1 2.7 5.6 4.6 4.3 6.3 3.6 8.6 3.6 11.5v.1c0 2.9.7 5.3 2 6.9 1.5 1.9 3.8 2.9 6.6 2.9h.1c2.5 0 4.3-.7 5.8-2.2 2-2 1.9-4.5 1.3-6-.5-1-1.3-1.9-2.4-2.5zm-4.1 4.1c-1.1.1-2.2-.4-2.3-1.4 0-.8.5-1.6 2.3-1.7h.6c.6 0 1.2.1 1.7.2-.2 2.4-1.3 2.8-2.3 2.9z"/></svg>
  ) },
  { label: "TikTok", href: link("VITE_SOCIAL_TIKTOK"), bg: "#000000", icon: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="white"><path d="M16.6 5.8A4.3 4.3 0 0 1 15.5 3h-3.1v12.4a2.6 2.6 0 1 1-1.8-2.5V9.8a5.7 5.7 0 1 0 4.9 5.6V9a7.3 7.3 0 0 0 4.3 1.4V7.3a4.3 4.3 0 0 1-3.2-1.5z"/></svg>
  ) },
  { label: "LinkedIn", href: link("VITE_SOCIAL_LINKEDIN"), bg: "#0A66C2", icon: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="white"><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9h4v12H3zM9 9h3.8v1.7h.1c.5-1 1.8-2 3.8-2 4 0 4.8 2.6 4.8 6V21h-4v-5.5c0-1.3 0-3-1.8-3s-2.1 1.4-2.1 2.9V21H9z"/></svg>
  ) },
  { label: "YouTube", href: link("VITE_SOCIAL_YOUTUBE"), bg: "#FF0000", icon: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="white"><path d="M10 15.5v-7l6 3.5-6 3.5z"/></svg>
  ) },
  { label: "X", href: link("VITE_SOCIAL_X"), bg: "#000000", icon: (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="white"><path d="M18.9 2H22l-7.6 8.7L23.3 22h-7.1l-5.6-6.9L4.2 22H1l8.2-9.3L1 2h7.3l5 6.4L18.9 2Zm-1.2 18h1.9L7.4 4H5.4l12.3 16Z"/></svg>
  ) },
  { label: "WhatsApp", href: link("VITE_SOCIAL_WHATSAPP", `https://wa.me/${String(env.VITE_WHATSAPP_NUMBER ?? "27614615035").replace(/\D/g, "")}`), bg: "#25D366", icon: (
    <svg viewBox="0 0 32 32" width="16" height="16" fill="white"><path d="M16.04 3C9.4 3 4 8.34 4 14.92c0 2.3.66 4.45 1.8 6.27L4 29l8.03-1.76a12.1 12.1 0 0 0 4.01.68C22.68 27.92 28 22.58 28 16S22.68 3 16.04 3zm5.33 14.44c-.29-.15-1.73-.85-2-.95-.27-.1-.47-.15-.66.15-.2.29-.76.95-.93 1.14-.17.2-.34.22-.63.07-.29-.15-1.23-.45-2.35-1.44-.87-.77-1.45-1.72-1.62-2.01-.17-.29-.02-.45.13-.6.13-.13.29-.34.44-.51.15-.17.2-.29.29-.49.1-.2.05-.37-.02-.51-.07-.15-.66-1.58-.9-2.16-.24-.57-.48-.49-.66-.5h-.56c-.2 0-.51.07-.78.37-.27.29-1.02 1-1.02 2.43 0 1.44 1.05 2.82 1.19 3.02.15.2 2.06 3.14 5 4.4.7.3 1.24.48 1.67.61.7.22 1.34.19 1.84.12.56-.08 1.73-.7 1.97-1.38.24-.68.24-1.26.17-1.38-.07-.12-.27-.2-.56-.34z"/></svg>
  ) },
].filter(s => /^https:\/\//.test(s.href));

const PAYMENT_BADGES = [
  "VISA", "Mastercard", "American Express", "Diners Club", "PayFast", "Ozow",
  "eBucks", "Mobicred", "Discovery Miles", "PayFlex", "PayJustNow",
];

const APP_BADGES = [
  { store: "App Store", cta: "Download on the", brand: "App Store" },
  { store: "Google Play", cta: "GET IT ON", brand: "Google Play" },
  { store: "AppGallery", cta: "EXPLORE IT ON", brand: "AppGallery" },
];

function LinkColumn({ title, links, onLinkClick }: { title: string; links: string[]; onLinkClick: (label: string) => void }) {
  return (
    <div>
      <p style={{ color: HEADING, fontSize: 16, fontFamily: "'Fraunces', serif", fontWeight: 600, marginBottom: 14 }}>{title}</p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 11 }}>
        {links.map((l) => (
          <li key={l}>
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); onLinkClick(l); }}
              style={{ color: LINK, fontSize: 14, lineHeight: "19px", textDecoration: "none" }}
              onMouseEnter={(e) => { (e.target as HTMLAnchorElement).style.textDecoration = "underline"; }}
              onMouseLeave={(e) => { (e.target as HTMLAnchorElement).style.textDecoration = "none"; }}
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
  // through from App.tsx. None of these link out anywhere real yet --
  // they're the footer's structure, not wired-up destinations.
  const handleLinkClick = onLinkClick ?? ((label: string) => {
    window.dispatchEvent(new CustomEvent("ballylife:footer-link", { detail: { label } }));
  });

  return (
    <footer style={{ background: BG, fontFamily: "'Inter','Roboto',sans-serif", borderTop: "1px solid #E8E4DA" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "48px 40px 32px" }}>

        {/* Link columns */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "32px 24px", marginBottom: 40 }}>
          {COLS.map((c) => (
            <LinkColumn key={c.title} title={c.title} links={c.links} onLinkClick={handleLinkClick} />
          ))}
        </div>

        {/* Apps + social */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "32px 64px", marginBottom: 32 }}>
          <div>
            <p style={{ color: HEADING, fontSize: 16, fontFamily: "'Fraunces', serif", fontWeight: 600, marginBottom: 14 }}>Download Our Apps</p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {APP_BADGES.map((a) => (
                <div key={a.store} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  background: "#000", borderRadius: 8, padding: "7px 14px",
                  opacity: 0.85, cursor: "default",
                }}>
                  <span style={{ color: "#fff", fontSize: 9, lineHeight: 1.3 }}>
                    {a.cta}<br /><strong style={{ fontSize: 13 }}>{a.brand}</strong>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p style={{ color: HEADING, fontSize: 16, fontFamily: "'Fraunces', serif", fontWeight: 600, marginBottom: 14 }}>Follow Us</p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {SOCIALS.map((s) => (
                <a key={s.label} href={s.href} title={`Ballylife on ${s.label}`} aria-label={`Ballylife on ${s.label}`}
                  target="_blank" rel="noopener noreferrer"
                  style={{ width: 32, height: 32, borderRadius: "50%", background: s.bg, display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  {s.icon}
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* Category links */}
        <div style={{ borderTop: "1px solid #E8E4DA", paddingTop: 20 }}>
          <p style={{ fontSize: 13, lineHeight: "26px" }}>
            {CATEGORY_LINKS.map((c, i) => (
              <span key={c}>
                <a href="#" onClick={(e) => { e.preventDefault(); handleLinkClick(c); }} style={{ color: LINK, textDecoration: "none" }}
                  onMouseEnter={(e) => { (e.target as HTMLAnchorElement).style.textDecoration = "underline"; }}
                  onMouseLeave={(e) => { (e.target as HTMLAnchorElement).style.textDecoration = "none"; }}
                >
                  {c}
                </a>
                {i < CATEGORY_LINKS.length - 1 && <span style={{ color: "#B8B2A3" }}> &nbsp;/&nbsp; </span>}
              </span>
            ))}
          </p>
        </div>
      </div>

      {/* Bottom bar */}
      <div style={{ background: BAR_BLUE }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "16px 40px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            {PAYMENT_BADGES.map((p) => (
              <span key={p} style={{ color: "#fff", fontSize: 12, fontWeight: 700, opacity: 0.92, whiteSpace: "nowrap" }}>{p}</span>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src={ballylifeLogo} alt="" style={{ height: 32, width: "auto", filter: "brightness(0) invert(1)" }} />
            <span style={{ color: "rgba(255,255,255,0.85)", fontSize: 12 }}>© Ballylife Online (Pty) Ltd.</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
