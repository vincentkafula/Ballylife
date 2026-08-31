import ballylifeLogo from "../imports/ballylife-logo-compact.png";

const BG      = "#FAF6EC";
const HEADING = "#211C16";
const LINK    = "#6B5A3E";
const BAR_BLUE = "#D2691E";

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
    links: ["About Us", "Careers", "Sell on Ballylife", "Deliver for Ballylife", "Press & News", "Competitions", "Ballylife for Business", "Ballylife Home Loan Hub", "Ballylife.credit"],
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

const SOCIALS = [
  { label: "Facebook", bg: "#1877F2", icon: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="white"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" /></svg>
  ) },
  { label: "X", bg: "#000000", icon: (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="white"><path d="M18.9 2H22l-7.6 8.7L23.3 22h-7.1l-5.6-6.9L4.2 22H1l8.2-9.3L1 2h7.3l5 6.4L18.9 2Zm-1.2 18h1.9L7.4 4H5.4l12.3 16Z"/></svg>
  ) },
  { label: "Instagram", bg: "linear-gradient(45deg,#F58529,#DD2A7B,#8134AF,#515BD4)", icon: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="white" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="white" stroke="none" /></svg>
  ) },
];

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
            <div style={{ display: "flex", gap: 10 }}>
              {SOCIALS.map((s) => (
                <a key={s.label} href="#" title={s.label}
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
            <img src={ballylifeLogo} alt="" style={{ height: 20, width: "auto", filter: "brightness(0) invert(1)" }} />
            <span style={{ color: "rgba(255,255,255,0.85)", fontSize: 12 }}>© Ballylife Online (Pty) Ltd.</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
