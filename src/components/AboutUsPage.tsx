import { useRef } from "react";

// No <script> needed -- this page is storytelling content, not an
// interactive tool. Still rendered via an iframe's srcDoc, consistent
// with the other standalone pages, so its typography/color system
// stays isolated from the rest of the app.
const ABOUT_PAGE_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>About Us - Ballylife</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Karla:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root{
    --ink: #1E2622;
    --paper: #F7F4EA;
    --paper-deep: #EEE8D6;
    --paper-line: #E4DEC8;
    --pine: #1F362B;
    --pine-soft: #40594A;
    --gold: #B0873F;
    --gold-soft: #DCC492;
    --line: rgba(31,54,43,0.15);
    --content-max: 740px;
    --page-max: 1180px;
    --mono: 'JetBrains Mono', monospace;
  }
  *{ box-sizing: border-box; }
  html{ scroll-behavior: smooth; }
  body{
    margin:0; background: var(--paper); color: var(--ink);
    font-family: 'Karla', sans-serif; font-size: 17px; line-height: 1.72;
    -webkit-font-smoothing: antialiased;
  }
  h1, h2, h3, h4{ font-family: 'Fraunces', serif; color: var(--pine); margin: 0; font-weight: 500; }
  a{ color: var(--pine); }

  .hero{
    background:
      radial-gradient(900px 460px at 12% -25%, rgba(176,135,63,0.20), transparent 60%),
      radial-gradient(700px 420px at 100% 0%, rgba(64,89,74,0.35), transparent 55%),
      linear-gradient(180deg, var(--pine) 0%, #14211a 100%);
    color: var(--paper);
    position: relative; overflow: hidden;
  }
  .hero-inner{ max-width: var(--page-max); margin: 0 auto; padding: 88px 32px; position: relative; }
  .kicker{ font-family: var(--mono); font-size: 13px; letter-spacing: 0.03em; color: var(--gold-soft); margin-bottom: 20px; display: block; }
  .hero h1{ color: var(--paper); font-size: clamp(32px, 5vw, 52px); line-height: 1.12; max-width: 16ch; }
  .hero p.lede{ margin: 24px 0 0; max-width: 60ch; font-size: 18.5px; color: #D8E0D2; }

  .hero-stats{
    margin-top: 44px; display: grid; grid-template-columns: repeat(4, 1fr);
    border-top: 1px solid rgba(246,243,234,0.18);
  }
  .hero-stat{ padding: 20px 22px 0 0; }
  .hero-stat .num{ font-family: 'Fraunces', serif; font-size: 24px; color: var(--gold-soft); }
  .hero-stat .lbl{ font-size: 12.5px; color: #C9D3C2; margin-top: 4px; }
  @media (max-width: 780px){
    .hero-inner{ padding: 64px 24px; }
    .hero-stats{ grid-template-columns: 1fr 1fr; }
  }

  .page{ max-width: var(--content-max); margin: 0 auto; padding: 0 32px; }
  section{ padding: 56px 0; border-bottom: 1px solid var(--line); }
  section:last-of-type{ border-bottom: none; }
  .eyebrow{ font-family: var(--mono); color: var(--gold); font-size: 13px; margin-bottom: 12px; display: block; letter-spacing: 0.02em; }
  h2{ font-size: clamp(22px, 3vw, 30px); max-width: 22ch; }
  .lead-para{ font-size: 18px; color: var(--pine-soft); max-width: 58ch; margin-top: 14px; }
  p{ margin: 15px 0; max-width: 62ch; }

  .values-grid{ display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 28px; }
  .value-card{ background: var(--paper-deep); border: 1px solid var(--paper-line); padding: 22px 24px; }
  .value-card h4{ font-size: 17px; margin-bottom: 8px; }
  .value-card p{ font-size: 15px; margin: 0; }
  @media (max-width: 640px){ .values-grid{ grid-template-columns: 1fr; } }

  .timeline{ margin-top: 32px; position: relative; padding-left: 28px; }
  .timeline::before{ content: ""; position: absolute; left: 5px; top: 6px; bottom: 6px; width: 1px; background: var(--paper-line); }
  .tl-item{ position: relative; padding-bottom: 28px; }
  .tl-item:last-child{ padding-bottom: 0; }
  .tl-item::before{ content: ""; position: absolute; left: -28px; top: 4px; width: 11px; height: 11px; border-radius: 50%; background: var(--paper); border: 2px solid var(--gold); }
  .tl-item h4{ font-size: 17px; margin-bottom: 5px; }
  .tl-item p{ font-size: 15.5px; margin: 0; }

  .pillar-grid{ margin-top: 28px; display: grid; gap: 0; }
  .pillar{ display: grid; grid-template-columns: 140px 1fr; gap: 20px; padding: 18px 0; border-top: 1px solid var(--line); }
  .pillar:last-child{ border-bottom: 1px solid var(--line); }
  .pillar .tag{ font-family: 'Fraunces', serif; font-style: italic; color: var(--gold); font-size: 16px; }
  .pillar p{ margin: 0; font-size: 15.5px; max-width: 56ch; }
  @media (max-width: 640px){ .pillar{ grid-template-columns: 1fr; gap: 6px; } }

  .cta-box{ margin-top: 26px; background: var(--pine); color: var(--paper); padding: 30px 32px; display: grid; gap: 18px; grid-template-columns: 1fr 1fr; }
  .cta-box h3{ color: var(--paper); font-size: 19px; margin-bottom: 8px; }
  .cta-box p{ color: #D8E0D2; font-size: 14.5px; margin: 0; max-width: 40ch; }
  .cta-box .addr{ font-family: var(--mono); font-size: 14px; color: var(--gold-soft); display: inline-block; margin-top: 10px; border-bottom: 1px dashed rgba(220,196,146,0.5); }
  @media (max-width: 640px){ .cta-box{ grid-template-columns: 1fr; } }

  .note{ margin-top: 18px; font-size: 14px; color: var(--pine-soft); border-left: 2px solid var(--gold-soft); padding-left: 16px; }
  footer{ max-width: var(--content-max); margin: 0 auto; padding: 0 32px 84px; color: var(--pine-soft); font-size: 14px; }
</style>
</head>
<body>

  <header class="hero">
    <div class="hero-inner">
      <span class="kicker">Ballylife &middot; About Us</span>
      <h1>Africa's next great marketplace, built from Lusaka outward.</h1>
      <p class="lede">Ballylife is a multi-vendor marketplace built for how Africa actually shops -- fast delivery, verified sellers, and a growing footprint across the continent. We're early, we're building in the open, and we have big plans.</p>
      <div class="hero-stats">
        <div class="hero-stat"><div class="num">2</div><div class="lbl">countries live today: Zambia &amp; South Africa</div></div>
        <div class="hero-stat"><div class="num">55</div><div class="lbl">African countries on our roadmap</div></div>
        <div class="hero-stat"><div class="num">6</div><div class="lbl">verified seller storefronts and growing</div></div>
        <div class="hero-stat"><div class="num">60</div><div class="lbl">minute average delivery, where we operate</div></div>
      </div>
    </div>
  </header>

  <div class="page">

    <section>
      <span class="eyebrow">Why we exist</span>
      <h2>Shopping in Africa deserves better logistics, not just a bigger catalog</h2>
      <p class="lead-para">Most marketplaces built for other markets don't account for what actually matters here: unreliable last-mile delivery, sellers customers can't easily vet, and a payments landscape that doesn't look like the West's. Ballylife starts from those realities instead of retrofitting around them.</p>
      <p>We're building a platform where every seller is verified before they list, where delivery speed is a real design constraint rather than an afterthought, and where the tools we give sellers and buyers reflect how commerce actually works across the continent -- not a template borrowed from somewhere else.</p>
    </section>

    <section>
      <span class="eyebrow">Where we are today</span>
      <h2>Early, honest about it, and moving fast</h2>
      <p class="lead-para">Ballylife is genuinely still being built. Our head office is in Lusaka, Zambia, with an active storefront presence in South Africa, and we're expanding deliberately rather than trying to be everywhere at once.</p>
      <div class="timeline">
        <div class="tl-item">
          <h4>Head office -- Lusaka, Zambia</h4>
          <p>Where Ballylife is run from day to day, and our first fully operational market.</p>
        </div>
        <div class="tl-item">
          <h4>South Africa -- active storefronts</h4>
          <p>Verified sellers already trading, with logistics built around fast, local delivery.</p>
        </div>
        <div class="tl-item">
          <h4>Rest of Africa -- opening soon</h4>
          <p>Every other African country is on our roadmap. Check the Contact page for the specific cities we're planning to open in next.</p>
        </div>
      </div>
    </section>

    <section>
      <span class="eyebrow">What we're building</span>
      <h2>Not just a storefront -- a fuller commerce platform</h2>
      <p class="lead-para">Ballylife is a marketplace first, but we're building the pieces around it that a growing platform actually needs.</p>
      <div class="pillar-grid">
        <div class="pillar"><span class="tag">Marketplace</span><p>Independent verified sellers, each setting their own pricing on top of what they pay their suppliers -- Ballylife handles discovery, checkout, and delivery logistics.</p></div>
        <div class="pillar"><span class="tag">Vehicles</span><p>A dedicated department for buying vehicles online, with real compliance handling for cross-border rules like South Africa's ITAC restrictions and Zambia's ZRA duty schedule.</p></div>
        <div class="pillar"><span class="tag">Ballylife.credit</span><p>A rewards programme that gives money back on purchases made through a linked credit account -- part of a broader push toward financial inclusion, not just discounts.</p></div>
        <div class="pillar"><span class="tag">For Business</span><p>Volume buying for registered companies, with rebates that scale as monthly spend grows -- built for procurement teams, not just individual shoppers.</p></div>
      </div>
    </section>

    <section>
      <span class="eyebrow">What we care about</span>
      <h2>The things we're not willing to compromise on</h2>
      <div class="values-grid">
        <div class="value-card">
          <h4>Verified, always</h4>
          <p>Every seller on Ballylife is checked before they can list -- trust isn't a badge we hand out after the fact.</p>
        </div>
        <div class="value-card">
          <h4>Speed as a promise</h4>
          <p>Fast delivery isn't a marketing line here -- it's a real constraint we design our logistics and seller requirements around.</p>
        </div>
        <div class="value-card">
          <h4>Fair to sellers</h4>
          <p>Transparent commission, sellers set their own retail pricing, and clear settlement timelines -- not opaque terms buried in fine print.</p>
        </div>
        <div class="value-card">
          <h4>Honest about where we are</h4>
          <p>If something isn't built yet, we say so -- on this very page, and across the rest of the platform. We'd rather be accurate than impressive.</p>
        </div>
      </div>
    </section>

    <section>
      <span class="eyebrow">Get involved</span>
      <h2>Sell with us, or just say hello</h2>
      <p class="lead-para">Whether you're a seller thinking about listing, or just want to know more about where we're headed, we'd like to hear from you.</p>
      <div class="cta-box">
        <div>
          <h3>Sell on Ballylife</h3>
          <p>Register as a seller directly from the site -- click "Sell on Ballylife" in the footer to get started.</p>
        </div>
        <div>
          <h3>Everything else</h3>
          <p>Careers, partnerships, press, or just a question -- our Contact page reaches the right team.</p>
          <a class="addr" href="#" onclick="window.parent.postMessage('ballylife:contact','*'); return false;">Get in touch</a>
        </div>
      </div>
      <p class="note">Ballylife Online (Pty) Ltd is registered in South Africa, with its head office in Lusaka, Zambia. Full registration and legal entity details are published in our Platform Terms.</p>
    </section>

  </div>

  <footer>
    <p>This page is updated as Ballylife grows -- what's written here reflects where we actually are today, not where we hope to be.</p>
  </footer>

</body>
</html>`;

export function AboutUsPage({ onBack, onContact }: { onBack: () => void; onContact: () => void }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white">
      <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-2.5 border-b border-gray-200 bg-white shadow-sm shrink-0">
        <button onClick={onBack} className="group flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-emerald-700 rounded-full pl-2.5 pr-3.5 py-1.5 hover:bg-emerald-50 transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:-translate-x-0.5">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back to shopping
        </button>
      </div>
      <iframe
        ref={iframeRef}
        title="About Ballylife"
        srcDoc={ABOUT_PAGE_HTML}
        className="flex-1 w-full border-0"
        style={{ minHeight: 0 }}
        onLoad={() => {
          const handler = (e: MessageEvent) => { if (e.data === "ballylife:contact") onContact(); };
          window.addEventListener("message", handler, { once: true });
        }}
      />
    </div>
  );
}
