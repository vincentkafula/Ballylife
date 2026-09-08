import { useRef } from "react";

// Has its own scroll-spy <script> (highlights the active section in both
// the sidebar rail and top nav as the reader scrolls) -- rendered via an
// iframe's srcDoc for the same reason as the other standalone pages:
// dangerouslySetInnerHTML never executes injected <script> tags, and the
// iframe keeps this page's bespoke typography/color system isolated
// from the rest of the app.
const PRIVACY_PAGE_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Privacy Policy - Ballylife</title>
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
    --ok: #3E6B4F;
    --no: #A0432E;
    --line: rgba(31,54,43,0.15);
    --content-max: 740px;
    --page-max: 1180px;
    --mono: 'JetBrains Mono', monospace;
  }

  *{ box-sizing: border-box; }
  html{ scroll-behavior: smooth; }

  body{
    margin:0;
    background: var(--paper);
    color: var(--ink);
    font-family: 'Karla', sans-serif;
    font-size: 17px;
    line-height: 1.72;
    -webkit-font-smoothing: antialiased;
  }

  h1, h2, h3, h4{ font-family: 'Fraunces', serif; color: var(--pine); margin: 0; font-weight: 500; }
  a{ color: var(--pine); }
  code, .mono{ font-family: var(--mono); }

  .topbar{
    position: sticky; top: 0; z-index: 30;
    background: rgba(247,244,234,0.94);
    backdrop-filter: blur(6px);
    border-bottom: 1px solid var(--line);
  }
  .topbar-inner{
    max-width: var(--page-max); margin: 0 auto; padding: 15px 32px;
    display: flex; align-items: center; justify-content: space-between; gap: 20px;
  }
  .wordmark{ font-family: 'Fraunces', serif; font-size: 18px; color: var(--pine); display: flex; align-items: baseline; gap: 8px; white-space: nowrap; }
  .wordmark small{ font-family: var(--mono); font-size: 11px; color: var(--pine-soft); }
  .topbar nav{ display: flex; gap: 15px; font-size: 13px; overflow-x: auto; }
  .topbar nav a{
    color: var(--pine-soft); text-decoration: none; white-space: nowrap;
    border-bottom: 1px solid transparent; padding-bottom: 2px;
    transition: border-color .15s ease, color .15s ease;
  }
  .topbar nav a:hover, .topbar nav a.active{ color: var(--pine); border-color: var(--gold); }
  .contact-btn{
    font-family: var(--mono); font-size: 12.5px; color: var(--paper);
    background: var(--pine); padding: 8px 14px; text-decoration: none; white-space: nowrap;
  }
  @media (max-width: 1040px){ .topbar nav{ display: none; } }

  .hero{
    background:
      radial-gradient(900px 460px at 12% -25%, rgba(176,135,63,0.20), transparent 60%),
      radial-gradient(700px 420px at 100% 0%, rgba(64,89,74,0.35), transparent 55%),
      linear-gradient(180deg, var(--pine) 0%, #14211a 100%);
    color: var(--paper);
    position: relative;
    overflow: hidden;
  }
  .hero-inner{ max-width: var(--page-max); margin: 0 auto; padding: 88px 32px 0; position: relative; }
  .kicker{ font-family: var(--mono); font-size: 13px; letter-spacing: 0.03em; color: var(--gold-soft); margin-bottom: 20px; display: block; }
  .hero h1{ color: var(--paper); font-size: clamp(30px, 4.6vw, 48px); line-height: 1.14; max-width: 14ch; }
  .hero p.lede{ margin: 24px 0 0; max-width: 60ch; font-size: 18px; color: #D8E0D2; }

  .hero-stats{
    margin-top: 44px; display: grid; grid-template-columns: repeat(4, 1fr);
    border-top: 1px solid rgba(246,243,234,0.18);
  }
  .hero-stat{ padding: 20px 22px 26px 0; border-right: 1px solid rgba(246,243,234,0.18); }
  .hero-stat:last-child{ border-right: none; padding-right: 0; }
  .hero-stat .num{ font-family: 'Fraunces', serif; font-size: 22px; color: var(--gold-soft); }
  .hero-stat .lbl{ font-size: 12.5px; color: #C9D3C2; margin-top: 4px; }
  @media (max-width: 820px){
    .hero-inner{ padding: 60px 24px 0; }
    .hero-stats{ grid-template-columns: 1fr 1fr; }
    .hero-stat{ border-right: none; border-bottom: 1px solid rgba(246,243,234,0.18); padding: 16px 0; }
  }

  .body-grid{
    max-width: var(--page-max); margin: 0 auto; padding: 0 32px;
    display: grid; grid-template-columns: 220px 1fr; gap: 56px; align-items: start;
  }
  .rail{ position: sticky; top: 74px; padding-top: 64px; font-size: 13.5px; max-height: calc(100vh - 90px); overflow-y: auto; }
  .rail-title{ font-family: var(--mono); color: var(--gold); font-size: 12px; margin-bottom: 14px; letter-spacing: 0.02em; }
  .rail a{
    display: block; padding: 6px 0; color: var(--pine-soft); text-decoration: none;
    border-left: 2px solid transparent; padding-left: 12px; margin-left: -13px;
    transition: color .15s ease, border-color .15s ease;
  }
  .rail a:hover, .rail a.active{ color: var(--pine); border-color: var(--gold); }
  @media (max-width: 980px){ .body-grid{ grid-template-columns: 1fr; } .rail{ display: none; } }

  .content{ min-width: 0; }
  section{ padding: 54px 0; border-bottom: 1px solid var(--line); max-width: var(--content-max); }
  section:first-of-type{ padding-top: 66px; }
  section:last-of-type{ border-bottom: none; }

  .eyebrow{ font-family: var(--mono); color: var(--gold); font-size: 13px; margin-bottom: 12px; display: block; letter-spacing: 0.02em; }
  h2{ font-size: clamp(21px, 3vw, 27px); max-width: 26ch; }
  .lead-para{ font-size: 17.5px; color: var(--pine-soft); max-width: 58ch; margin-top: 14px; }
  p{ margin: 14px 0; max-width: 62ch; }
  h4{ font-size: 16.5px; margin: 22px 0 8px; }

  ul.plain{ margin: 12px 0; padding-left: 20px; }
  ul.plain li{ margin: 6px 0; font-size: 15.5px; }

  .info-grid{ margin-top: 24px; display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .info-card{ background: var(--paper-deep); border: 1px solid var(--paper-line); padding: 18px 20px; }
  .info-card .k{ font-family: 'Fraunces', serif; font-style: italic; color: var(--gold); font-size: 15px; margin-bottom: 6px; }
  .info-card .v{ font-size: 14.5px; color: var(--pine-soft); }
  @media (max-width: 640px){ .info-grid{ grid-template-columns: 1fr; } }

  .purpose{
    margin-top: 28px; padding: 20px 0; border-top: 1px solid var(--line);
  }
  .purpose:last-child{ border-bottom: 1px solid var(--line); }
  .purpose h4{ margin-top: 0; font-size: 17px; }
  .purpose ul.plain{ margin-top: 10px; }
  .tip{
    margin-top: 10px; font-size: 14px; color: var(--pine-soft);
    background: var(--paper-deep); padding: 10px 14px; border-left: 2px solid var(--gold);
  }

  .cond-cols{ display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 22px; }
  .cond-col h4{ font-size: 14.5px; margin: 0 0 12px; }
  .cond-col ul{ list-style: none; margin: 0; padding: 0; }
  .cond-col li{ font-size: 14.5px; padding: 9px 0; border-top: 1px solid var(--line); }
  .cond-col li:last-child{ border-bottom: 1px solid var(--line); }
  @media (max-width: 640px){ .cond-cols{ grid-template-columns: 1fr; } }

  .sec-grid{ margin-top: 24px; display: grid; gap: 16px; }
  .sec-item{
    display: grid; grid-template-columns: 130px 1fr; gap: 20px;
    padding: 16px 0; border-top: 1px solid var(--line);
  }
  .sec-item:last-child{ border-bottom: 1px solid var(--line); }
  .sec-item .tag{ font-family: var(--mono); color: var(--gold); font-size: 13px; }
  .sec-item p{ margin: 0; font-size: 15px; max-width: 56ch; }
  @media (max-width: 640px){ .sec-item{ grid-template-columns: 1fr; gap: 4px; } }

  .pw-list{ margin-top: 20px; }
  .pw-item{
    display: grid; grid-template-columns: 22px 1fr; gap: 12px;
    padding: 11px 0; border-top: 1px solid var(--line); font-size: 15px;
  }
  .pw-item:last-child{ border-bottom: 1px solid var(--line); }
  .pw-item .mark{ color: var(--gold); }

  .quote-block{
    background: var(--paper-deep); border-left: 3px solid var(--gold);
    padding: 22px 26px; margin: 22px 0 4px;
    font-family: 'Fraunces', serif; font-size: 17.5px; color: var(--pine);
    font-style: italic; line-height: 1.5;
  }

  .rights-grid{ margin-top: 22px; display: grid; gap: 0; }
  .right-item{
    display: grid; grid-template-columns: 26px 1fr; gap: 12px;
    padding: 12px 0; border-top: 1px solid var(--line); font-size: 15.5px;
  }
  .right-item:last-child{ border-bottom: 1px solid var(--line); }
  .right-item .n{ font-family: var(--mono); color: var(--gold); font-size: 13px; }

  .note{ margin-top: 18px; font-size: 14px; color: var(--pine-soft); border-left: 2px solid var(--gold-soft); padding-left: 16px; }

  .ai-grid{ margin-top: 24px; display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .ai-card{ background: var(--paper-deep); border: 1px solid var(--paper-line); padding: 18px 20px; }
  .ai-card .k{ font-family: 'Fraunces', serif; color: var(--pine); font-size: 15.5px; margin-bottom: 6px; }
  .ai-card .v{ font-size: 14px; color: var(--pine-soft); }
  @media (max-width: 640px){ .ai-grid{ grid-template-columns: 1fr; } }

  .cookie-list{ margin-top: 22px; }
  .cookie-item{
    display: grid; grid-template-columns: 26px 1fr; gap: 12px;
    padding: 12px 0; border-top: 1px solid var(--line); font-size: 15px;
  }
  .cookie-item:last-child{ border-bottom: 1px solid var(--line); }
  .cookie-item .mark{ color: var(--gold); }

  .report-box{ margin-top: 22px; background: var(--pine); color: var(--paper); padding: 26px 28px; }
  .report-box h3{ color: var(--paper); font-size: 17px; margin-bottom: 8px; }
  .report-box p{ color: #D8E0D2; font-size: 15px; margin: 0 0 14px; max-width: 56ch; }
  .report-box .addr{
    font-family: var(--mono); font-size: 16px; color: var(--gold-soft);
    display: inline-block; border-bottom: 1px dashed rgba(220,196,146,0.5);
  }
  .report-box a.plain{ color: var(--paper); }

  .page{ max-width: var(--page-max); margin: 0 auto; padding: 0 32px; }
  footer{ max-width: var(--content-max); padding: 44px 0 84px; color: var(--pine-soft); font-size: 13.5px; }
  footer .brand{ font-family: 'Fraunces', serif; color: var(--pine); font-size: 16px; margin-bottom: 6px; }
</style>
</head>
<body>

  <div class="topbar">
    <div class="topbar-inner">
      <div class="wordmark">Ballylife <small>/privacy</small></div>
      <nav id="topnav">
        <a href="#what-is-pi">What is PI</a>
        <a href="#why-collect">Why we collect</a>
        <a href="#sharing">Sharing</a>
        <a href="#security">Security</a>
        <a href="#retention">Retention</a>
        <a href="#rights">Your rights</a>
        <a href="#ai">AI use</a>
        <a href="#cookies">Cookies</a>
        <a href="#complaints">Complaints</a>
      </nav>
      <a class="contact-btn" href="#help">Help Centre</a>
    </div>
  </div>

  <header class="hero">
    <div class="hero-inner">
      <span class="kicker">Ballylife &middot; Privacy</span>
      <h1>Privacy Policy</h1>
      <p class="lede">This policy explains what personal information Ballylife collects, why we collect it, who we share it with, and the rights you have over it. Using our platform means this policy applies to you -- and it replaces any earlier version we've published.</p>
      <div class="hero-stats">
        <div class="hero-stat"><div class="num">POPIA</div><div class="lbl">the law this policy is built around</div></div>
        <div class="hero-stat"><div class="num">5</div><div class="lbl">rights you can exercise over your data</div></div>
        <div class="hero-stat"><div class="num">You</div><div class="lbl">choose whether we email you offers</div></div>
        <div class="hero-stat"><div class="num">2FA</div><div class="lbl">available to add to your account</div></div>
      </div>
    </div>
  </header>

  <div class="body-grid">
    <aside class="rail">
      <div class="rail-title">All topics</div>
      <a href="#what-is-pi">What is personal information?</a>
      <a href="#why-collect">Why we collect it</a>
      <a href="#sharing">When we share it</a>
      <a href="#security">How we keep it safe</a>
      <a href="#account-safety">Keeping your account safe</a>
      <a href="#retention">How long we keep it</a>
      <a href="#rights">Your rights under POPIA</a>
      <a href="#ai">Our use of AI</a>
      <a href="#overseas">Sending data overseas</a>
      <a href="#cookies">Cookies</a>
      <a href="#complaints">Lodging a complaint</a>
    </aside>

    <main class="content">

      <section id="what-is-pi">
        <span class="eyebrow">Definitions</span>
        <h2>What is personal information?</h2>
        <p class="lead-para">Put simply: if something you've shared with us could identify you, or reveal something about you, it's personal information.</p>
        <div class="info-grid">
          <div class="info-card"><div class="k">Who you are</div><div class="v">Name, address, contact details</div></div>
          <div class="info-card"><div class="k">What you're like</div><div class="v">Age, race, health, beliefs</div></div>
          <div class="info-card"><div class="k">Your history</div><div class="v">Education, work, finances</div></div>
          <div class="info-card"><div class="k">Your activity</div><div class="v">Browsing behaviour, location, social activity</div></div>
        </div>
      </section>

      <section id="why-collect">
        <span class="eyebrow">Purpose</span>
        <h2>Why we collect your personal information</h2>
        <p class="lead-para">We only ask for what we actually need, and we try to be clear about why we're asking each time.</p>

        <div class="purpose">
          <h4>To create and manage your account</h4>
          <p>Your name, email, and phone number let us set up your Ballylife account, help you log in securely, and keep your details current. You can update or correct any of it yourself under "My Account" at any time.</p>
          <div class="tip">If you subscribe to a Ballylife membership plan, we'll also need your banking details to process the subscription fee.</div>
        </div>

        <div class="purpose">
          <h4>To deliver your orders and handle returns</h4>
          <p>Placing an order means giving us a delivery address, and sometimes ID where a product carries an age restriction, plus a number we can reach you on about the delivery. We keep a record of your orders so we can help if you ever need a return or refund.</p>
        </div>

        <div class="purpose">
          <h4>To keep you updated, if you'd like that</h4>
          <p>With your permission, we may send news about sales, new products, offers from our partners, or suggestions based on what you've browsed or bought. You choose whether this happens -- change your mind anytime in your account settings, or unsubscribe from any email we send. If you're not yet a customer, you can ask us to stop marketing to you at any point too.</p>
        </div>

        <div class="purpose">
          <h4>To improve your experience</h4>
          <p>We look at things like what you've clicked on, and feedback from surveys or reviews, to understand broader trends and improve how Ballylife works. Before we use information this way, we strip out anything that identifies you personally.</p>
        </div>

        <div class="purpose">
          <h4>To grow our business and build new services</h4>
          <p>We sometimes research what customers like, trial new features, and use what we learn to decide what to offer next -- again, always with identifying details removed first.</p>
        </div>
      </section>

      <section id="sharing">
        <span class="eyebrow">Disclosure</span>
        <h2>When do we share your information?</h2>
        <p class="lead-para">We only share your information under specific conditions, and only with the kinds of parties below.</p>
        <div class="cond-cols">
          <div class="cond-col">
            <h4>We'll share it when:</h4>
            <ul>
              <li>You've given us permission</li>
              <li>We need to in order to fulfil our agreement with you</li>
              <li>The law requires it</li>
              <li>We need to protect you, us, or someone else</li>
            </ul>
          </div>
          <div class="cond-col">
            <h4>We may share it with:</h4>
            <ul>
              <li>Ballylife's affiliated businesses and partners</li>
              <li>Banks and payment processors</li>
              <li>Technology and service providers who keep our platform running</li>
              <li>Legal authorities, where required</li>
            </ul>
          </div>
        </div>
      </section>

      <section id="security">
        <span class="eyebrow">Protection</span>
        <h2>How we keep your personal information safe</h2>
        <p class="lead-para">Our data centres restrict physical access, and we back that up with a set of digital safeguards.</p>
        <div class="sec-grid">
          <div class="sec-item"><span class="tag">Encryption</span><p>Data is encrypted both while it's stored and while it's being transmitted.</p></div>
          <div class="sec-item"><span class="tag">Access control</span><p>Only people who genuinely need access for their role get it, and we review those permissions regularly.</p></div>
          <div class="sec-item"><span class="tag">Monitoring</span><p>Systems watch for suspicious activity, with procedures ready to act quickly if something's found.</p></div>
          <div class="sec-item"><span class="tag">Partners</span><p>Every partner we work with signs an agreement to protect your data and must verify their own security measures.</p></div>
        </div>
        <p class="note">If a security incident ever puts your personal information at risk, we'll let you know as soon as we reasonably can.</p>
      </section>

      <section id="account-safety">
        <span class="eyebrow">Your part in this</span>
        <h2>How you can keep your account safe</h2>
        <p class="lead-para">Never share your login details with anyone -- most account compromises start with a password reused somewhere else that's already been leaked.</p>
        <div class="pw-list">
          <div class="pw-item"><span class="mark">-</span><span>Use at least 8 characters, mixing uppercase letters, numbers, and symbols.</span></div>
          <div class="pw-item"><span class="mark">-</span><span>Never reuse the same password across different websites.</span></div>
          <div class="pw-item"><span class="mark">-</span><span>Consider a password manager to store them securely.</span></div>
          <div class="pw-item"><span class="mark">-</span><span>Turn on Two-Step Verification in your account settings for an extra layer of protection.</span></div>
        </div>
        <p class="note">Ballylife links out to other websites from time to time. Once you're there, their own privacy policy applies, not ours -- it's worth a glance before sharing anything.</p>
      </section>

      <section id="retention">
        <span class="eyebrow">Duration</span>
        <h2>How long do we keep your personal information?</h2>
        <p class="lead-para">We keep information only for as long as we actually need it -- while you're using our services, where the law requires it, or for our own record-keeping.</p>
        <p>If we're using your information for more than one purpose and one of those no longer applies, we stop using it for that purpose specifically, while continuing where it's still needed. Unsubscribing from marketing emails, for instance, stops us using your address for marketing right away -- but we may still need it for order updates.</p>
        <div class="quote-block">
          You're in control. You can ask us to delete your personal information at any time, though doing so may limit some of the services we can offer you.
        </div>
      </section>

      <section id="rights">
        <span class="eyebrow">POPIA</span>
        <h2>What are your rights under POPIA?</h2>
        <p class="lead-para">South Africa's Protection of Personal Information Act gives you a set of concrete rights over your own data.</p>
        <div class="rights-grid">
          <div class="right-item"><span class="n">a</span><span>Request a record or description of the personal information we hold about you -- we'll explain if we can't provide part of it.</span></div>
          <div class="right-item"><span class="n">b</span><span>Ask which third parties have had access to your information.</span></div>
          <div class="right-item"><span class="n">c</span><span>Ask us to correct inaccurate information -- or update it yourself under "My Account."</span></div>
          <div class="right-item"><span class="n">d</span><span>Ask us to delete your personal information.</span></div>
          <div class="right-item"><span class="n">e</span><span>Object to how we're using it, though this may affect what we can offer you.</span></div>
        </div>
        <p class="note">Even after a deletion or objection request, we may need to retain some information for legal reasons. Changes can take time to reflect across all our systems, and complex requests may carry an administrative fee. To act on any of this, just reach out through our Help Centre.</p>
      </section>

      <section id="ai">
        <span class="eyebrow">Artificial intelligence</span>
        <h2>How we use AI, and what governs it</h2>
        <p class="lead-para">We use AI to help you shop -- suggesting products you might like, or helping you find something faster.</p>
        <div class="ai-grid">
          <div class="ai-card"><div class="k">Humans stay in charge</div><div class="v">AI supports our team; it doesn't make decisions on Ballylife's behalf.</div></div>
          <div class="ai-card"><div class="k">Proven technology</div><div class="v">We use AI tools that are established and well-tested, not experimental.</div></div>
          <div class="ai-card"><div class="k">Privacy by design</div><div class="v">Our AI systems follow the same strict privacy and security rules as the rest of our platform.</div></div>
          <div class="ai-card"><div class="k">Checked for bias</div><div class="v">We regularly review our AI systems for bias.</div></div>
        </div>
      </section>

      <section id="overseas">
        <span class="eyebrow">Cross-border transfers</span>
        <h2>Do we send your personal information overseas?</h2>
        <p class="lead-para">Sometimes -- for example, our cloud infrastructure may store data on servers in other countries.</p>
        <p>We only transfer what's necessary, and only where safeguards aligned with South African privacy law are in place first.</p>
      </section>

      <section id="cookies">
        <span class="eyebrow">On your device</span>
        <h2>Do we use cookies?</h2>
        <p class="lead-para">We do -- the small text files kind, not the crumbly kind. They help us remember your preferences and past visits.</p>
        <div class="cookie-list">
          <div class="cookie-item"><span class="mark">-</span><span>Show you products and content more relevant to you</span></div>
          <div class="cookie-item"><span class="mark">-</span><span>Understand how people use our platform, so we can improve it</span></div>
          <div class="cookie-item"><span class="mark">-</span><span>See which features work well, through anonymised analytics</span></div>
          <div class="cookie-item"><span class="mark">-</span><span>Spot suspicious activity and help keep everyone safe</span></div>
        </div>
      </section>

      <section id="complaints">
        <span class="eyebrow">If something's wrong</span>
        <h2>How to lodge a complaint</h2>
        <p class="lead-para">If you're unhappy with how we've handled your personal information, or just have a question, we want to hear from you first.</p>
        <div class="report-box">
          <h3 id="help">Reach us through the Help Centre</h3>
          <p>Look for the Data &amp; Privacy section -- that routes your query to the right team.</p>
          <a class="addr" href="#">Visit the Ballylife Help Centre</a>
        </div>
        <p>If we're not able to resolve things to your satisfaction, you're entitled to take your complaint to South Africa's Information Regulator, whose contact details are published at <a href="https://justice.gov.za/inforeg/" target="_blank" rel="noopener">justice.gov.za/inforeg</a>.</p>
      </section>

    </main>
  </div>

  <div class="page">
    <footer>
      <div class="brand">Ballylife</div>
      <p>This version replaces any previous Privacy Policy published on our platform. We may update it from time to time -- using Ballylife means the current version applies to you.</p>
    </footer>
  </div>

  <script>
    var sections = document.querySelectorAll('main section[id]');
    var railLinks = document.querySelectorAll('.rail a');
    var topLinks = document.querySelectorAll('#topnav a');
    function setActive(id){
      railLinks.forEach(function(a){ a.classList.toggle('active', a.getAttribute('href') === '#' + id); });
      topLinks.forEach(function(a){ a.classList.toggle('active', a.getAttribute('href') === '#' + id); });
    }
    if ('IntersectionObserver' in window){
      var observer = new IntersectionObserver(function(entries){
        entries.forEach(function(entry){ if (entry.isIntersecting) setActive(entry.target.id); });
      }, { rootMargin: '-40% 0px -50% 0px', threshold: 0 });
      sections.forEach(function(s){ observer.observe(s); });
    }
  </script>

</body>
</html>`;

export function PrivacyPolicyPage({ onBack }: { onBack: () => void }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-2.5 border-b border-gray-100 bg-white shrink-0">
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-800">&larr; Back to shopping</button>
      </div>
      <iframe
        ref={iframeRef}
        title="Ballylife Privacy Policy"
        srcDoc={PRIVACY_PAGE_HTML}
        className="flex-1 w-full border-0"
        style={{ minHeight: 0 }}
      />
    </div>
  );
}
