import { PolicyPageFrame } from "./PolicyPageFrame";

// Has its own scroll-spy <script> (highlights the active section in both
// the sidebar rail and top nav as the reader scrolls) -- rendered via an
// iframe's srcDoc for the same reason as the other standalone pages:
// dangerouslySetInnerHTML never executes injected <script> tags, and the
// iframe keeps this page's bespoke typography/color system isolated
// from the rest of the app.
const BUSINESS_TERMS_PAGE_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Ballylife for Business Terms - Ballylife</title>
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
  .topbar nav{ display: flex; gap: 16px; font-size: 13.5px; overflow-x: auto; }
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
  @media (max-width: 980px){ .topbar nav{ display: none; } }

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
  .hero h1{ color: var(--paper); font-size: clamp(30px, 4.6vw, 48px); line-height: 1.14; max-width: 16ch; }
  .hero p.lede{ margin: 24px 0 0; max-width: 60ch; font-size: 18px; color: #D8E0D2; }

  .hero-stats{
    margin-top: 44px; display: grid; grid-template-columns: repeat(4, 1fr);
    border-top: 1px solid rgba(246,243,234,0.18);
  }
  .hero-stat{ padding: 20px 22px 26px 0; border-right: 1px solid rgba(246,243,234,0.18); }
  .hero-stat:last-child{ border-right: none; padding-right: 0; }
  .hero-stat .num{ font-family: 'Fraunces', serif; font-size: 24px; color: var(--gold-soft); }
  .hero-stat .lbl{ font-size: 12.5px; color: #C9D3C2; margin-top: 4px; }
  @media (max-width: 820px){
    .hero-inner{ padding: 60px 24px 0; }
    .hero-stats{ grid-template-columns: 1fr 1fr; }
    .hero-stat{ border-right: none; border-bottom: 1px solid rgba(246,243,234,0.18); padding: 16px 0; }
  }

  .body-grid{
    max-width: var(--page-max); margin: 0 auto; padding: 0 32px;
    display: grid; grid-template-columns: 210px 1fr; gap: 56px; align-items: start;
  }
  .rail{ position: sticky; top: 74px; padding-top: 64px; font-size: 13.5px; }
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
  h2{ font-size: clamp(21px, 3vw, 27px); max-width: 24ch; }
  .clause-num{ font-family: var(--mono); color: var(--gold); font-size: 14px; margin-right: 8px; }
  .lead-para{ font-size: 17.5px; color: var(--pine-soft); max-width: 58ch; margin-top: 14px; }
  p{ margin: 14px 0; max-width: 62ch; }

  .steps{ margin-top: 22px; }
  .step{
    display: grid; grid-template-columns: 30px 1fr; gap: 14px;
    padding: 13px 0; border-top: 1px solid var(--line); font-size: 15.5px;
  }
  .step:last-child{ border-bottom: 1px solid var(--line); }
  .step .n{ font-family: var(--mono); color: var(--gold); font-size: 13px; }

  .applies-box{
    margin-top: 22px; background: var(--paper-deep); border: 1px solid var(--paper-line);
    padding: 20px 24px; font-size: 15px;
  }
  .applies-box strong{ color: var(--pine); }

  .tier-table{ margin-top: 24px; border-top: 1px solid var(--line); }
  .tier-row{
    display: grid; grid-template-columns: 60px 1fr 90px;
    gap: 14px; padding: 12px 0; border-bottom: 1px solid var(--line); align-items: center;
  }
  .tier-row.head{ font-family: var(--mono); font-size: 11px; color: var(--pine-soft); letter-spacing: 0.02em; }
  .tier-row .t{
    font-family: 'Fraunces', serif; color: var(--paper); background: var(--pine);
    width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    font-size: 14px;
  }
  .tier-row.head .t{ background: none; color: var(--pine-soft); width: auto; height: auto; }
  .tier-row .spend{ font-size: 14.5px; }
  .tier-row .pct{ font-family: var(--mono); font-size: 14px; color: var(--gold); text-align: right; font-weight: 600; }
  @media (max-width: 640px){
    .tier-row{ grid-template-columns: 40px 1fr 70px; gap: 8px; }
  }

  .tagcloud{ display: flex; flex-wrap: wrap; gap: 9px; margin-top: 18px; }
  .tagcloud span{
    font-family: var(--mono); font-size: 12.5px; color: var(--pine-soft);
    border: 1px solid var(--paper-line); background: var(--paper-deep); padding: 7px 12px;
  }

  .note{ margin-top: 18px; font-size: 14px; color: var(--pine-soft); border-left: 2px solid var(--gold-soft); padding-left: 16px; }

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

  .report-box{ margin-top: 22px; background: var(--pine); color: var(--paper); padding: 26px 28px; }
  .report-box h3{ color: var(--paper); font-size: 17px; margin-bottom: 8px; }
  .report-box p{ color: #D8E0D2; font-size: 15px; margin: 0 0 14px; max-width: 56ch; }
  .report-box .addr{
    font-family: var(--mono); font-size: 16px; color: var(--gold-soft);
    display: inline-block; border-bottom: 1px dashed rgba(220,196,146,0.5);
  }

  .page{ max-width: var(--page-max); margin: 0 auto; padding: 0 32px; }
  footer{ max-width: var(--content-max); padding: 44px 0 84px; color: var(--pine-soft); font-size: 13.5px; }
  footer .brand{ font-family: 'Fraunces', serif; color: var(--pine); font-size: 16px; margin-bottom: 6px; }
</style>
</head>
<body>

  <div class="topbar">
    <div class="topbar-inner">
      <div class="wordmark">Ballylife <small>/for-business</small></div>
      <nav id="topnav">
        <a href="#joining">Joining</a>
        <a href="#rebates">Rebates</a>
        <a href="#vouchers">Vouchers</a>
        <a href="#rights">Our rights</a>
        <a href="#ending">Ending</a>
        <a href="#legal">Legal</a>
      </nav>
      <a class="contact-btn" href="mailto:b2b@ballylife.com">b2b@ballylife.com</a>
    </div>
  </div>

  <header class="hero">
    <div class="hero-inner">
      <span class="kicker">Ballylife &middot; For Business</span>
      <h1>Ballylife for Business Terms</h1>
      <p class="lede">Ballylife for Business lets registered companies buy at scale on Ballylife.com and earn a rebate on qualifying monthly spend. These terms explain how to join, how rebates are tiered, and what governs the relationship once you're in.</p>
      <div class="hero-stats">
        <div class="hero-stat"><div class="num">8</div><div class="lbl">rebate tiers based on monthly spend</div></div>
        <div class="hero-stat"><div class="num">0.5-4%</div><div class="lbl">rebate range across the tiers</div></div>
        <div class="hero-stat"><div class="num">3yr</div><div class="lbl">window to redeem rebate credit</div></div>
        <div class="hero-stat"><div class="num">20d</div><div class="lbl">notice period to leave the programme</div></div>
      </div>
    </div>
  </header>

  <div class="body-grid">
    <aside class="rail">
      <div class="rail-title">On this page</div>
      <a href="#intro">Introduction</a>
      <a href="#joining">Joining the programme</a>
      <a href="#ordering">Placing B2B orders</a>
      <a href="#rebates">How rebates work</a>
      <a href="#vouchers">Business gift vouchers</a>
      <a href="#priority">How these terms fit together</a>
      <a href="#rights">Our rights</a>
      <a href="#ending">Ending your participation</a>
      <a href="#legal">Legal odds &amp; ends</a>
    </aside>

    <main class="content">

      <section id="intro">
        <span class="eyebrow">Introduction</span>
        <h2><span class="clause-num">01</span>About this programme</h2>
        <p class="lead-para">Ballylife for Business is operated by Ballylife. It's built for registered businesses that want to buy from Ballylife.com regularly, at volume, with a rebate that grows alongside their spend.</p>
        <p>Throughout these terms, "you" or "B2B Buyer" means the business taking part in the programme, and "we," "us," or "Ballylife" means the company running it.</p>
      </section>

      <section id="joining">
        <span class="eyebrow">Getting started</span>
        <h2><span class="clause-num">02</span>Joining the programme</h2>
        <p class="lead-para">To take part, a business needs to apply and be approved before it can place orders as a B2B Buyer.</p>
        <div class="steps">
          <div class="step"><span class="n">1</span><span>Submit an application to join Ballylife for Business.</span></div>
          <div class="step"><span class="n">2</span><span>Provide a valid company registration number or VAT number.</span></div>
          <div class="step"><span class="n">3</span><span>Once approved, place orders through your Ballylife business account, subject to these terms.</span></div>
        </div>
      </section>

      <section id="ordering">
        <span class="eyebrow">How orders work</span>
        <h2><span class="clause-num">03</span>Placing B2B orders</h2>
        <p class="lead-para">Orders are placed through the B2B flow on your business account, at the prices and quantities Ballylife makes available at the time.</p>
        <p>Payment can be made using any method offered on Ballylife.com. Gift voucher purchases are the one exception -- those are paid by electronic bank transfer, in full, to our nominated account, with no deductions or set-off.</p>
      </section>

      <section id="rebates">
        <span class="eyebrow">Earning back on your spend</span>
        <h2><span class="clause-num">04</span>How the rebate tiers work</h2>
        <p class="lead-para">Rebates are earned on qualifying monthly spend -- what we call Net Merchandise Value: the price of goods bought excluding VAT, delivery, and insurance, net of any returns, cancellations, or discounts. The more you order in a month, the higher the tier and the rebate percentage.</p>
        <div class="tier-table">
          <div class="tier-row head"><span class="t">Tier</span><span>Monthly Net Merchandise Value</span><span style="text-align:right">Rebate</span></div>
          <div class="tier-row"><span class="t">1</span><span class="spend">R5,000 - R10,000</span><span class="pct">0.5%</span></div>
          <div class="tier-row"><span class="t">2</span><span class="spend">R10,001 - R20,000</span><span class="pct">1.0%</span></div>
          <div class="tier-row"><span class="t">3</span><span class="spend">R20,001 - R50,000</span><span class="pct">1.5%</span></div>
          <div class="tier-row"><span class="t">4</span><span class="spend">R50,001 - R100,000</span><span class="pct">2.0%</span></div>
          <div class="tier-row"><span class="t">5</span><span class="spend">R100,001 - R200,000</span><span class="pct">2.5%</span></div>
          <div class="tier-row"><span class="t">6</span><span class="spend">R200,001 - R300,000</span><span class="pct">3.0%</span></div>
          <div class="tier-row"><span class="t">7</span><span class="spend">R300,001 - R500,000</span><span class="pct">3.5%</span></div>
          <div class="tier-row"><span class="t">8</span><span class="spend">Over R500,001</span><span class="pct">4.0%</span></div>
        </div>
        <p>Rebates only apply to selected products and to orders that meet a tier's threshold. As with our other reward programmes, some products can't carry a rebate because we're legally restricted from offering one on them:</p>
        <div class="tagcloud">
          <span>Alcohol</span>
          <span>Tobacco</span>
          <span>Pharmaceuticals</span>
          <span>Infant &amp; follow-up formula</span>
          <span>Special dietary/medical formula</span>
          <span>Feeding bottles, teats &amp; spouted cups</span>
        </div>
        <p>The value of any of these products in an otherwise qualifying order is excluded before the rebate is calculated. Earned rebates are issued as credit to your Ballylife business profile and must be redeemed within three years of being issued, after which they expire. Rebate credit isn't transferable, can't be cashed out, and can't be set off against anything you owe us.</p>
      </section>

      <section id="vouchers">
        <span class="eyebrow">Buying at volume</span>
        <h2><span class="clause-num">05</span>Business gift vouchers</h2>
        <p class="lead-para">Buying gift vouchers through the B2B programme follows its own process, separate from ordering physical products.</p>
        <div class="steps">
          <div class="step"><span class="n">1</span><span>Request a written quotation and tax invoice for the vouchers you want.</span></div>
          <div class="step"><span class="n">2</span><span>Pay in full, for the quantities and prices confirmed in that quotation and invoice.</span></div>
          <div class="step"><span class="n">3</span><span>Email proof of payment to <a href="mailto:b2b@ballylife.com">b2b@ballylife.com</a>.</span></div>
          <div class="step"><span class="n">4</span><span>Once payment is confirmed, we email the vouchers to your nominated address.</span></div>
        </div>
        <p>If you notice a voucher has been misused or redeemed in error, tell us in writing as soon as you become aware of it. We'll look into it and share what we find with you.</p>
      </section>

      <section id="priority">
        <span class="eyebrow">How the rules stack</span>
        <h2><span class="clause-num">06</span>How these terms fit with our general terms</h2>
        <p class="lead-para">These B2B terms sit alongside the general terms and conditions published on Ballylife.com -- both apply to your orders.</p>
        <div class="quote-block">
          Where the two disagree on a specific point, these B2B terms take precedence.
        </div>
      </section>

      <section id="rights">
        <span class="eyebrow">What we can do</span>
        <h2><span class="clause-num">07</span>Our rights over the programme</h2>
        <p class="lead-para">We may, at our discretion and without needing to give you advance notice:</p>
        <div class="rights-grid">
          <div class="right-item"><span class="n">a</span><span>Approve or decline your application to join.</span></div>
          <div class="right-item"><span class="n">b</span><span>Suspend or end your participation, temporarily or permanently.</span></div>
          <div class="right-item"><span class="n">c</span><span>End the programme, in whole or in part.</span></div>
          <div class="right-item"><span class="n">d</span><span>Amend these terms, including rebate tiers, percentages, and voucher purchase criteria.</span></div>
        </div>
        <p>Changes take effect once published on Ballylife.com, and won't affect orders you placed before that date. It's your responsibility to check back for updates -- continuing to use the programme after a change means you accept it.</p>
      </section>

      <section id="ending">
        <span class="eyebrow">Leaving the programme</span>
        <h2><span class="clause-num">08</span>Ending your participation</h2>
        <p class="lead-para">You can leave the programme at any time, for any reason, by emailing us to say so.</p>
        <p>Your exit takes effect 20 business days after we receive your written notice. If a conflict of interest arises -- a competing interest or duty that could affect your role in the programme -- you need to disclose it to us promptly, and you should avoid it unless we've approved it in writing. A material conflict we haven't approved can be grounds for us to end your participation.</p>
      </section>

      <section id="legal">
        <span class="eyebrow">The fine print</span>
        <h2><span class="clause-num">09</span>Legal odds and ends</h2>
        <p class="lead-para">We're not liable for direct or indirect loss or cost arising from your participation in this programme or your use of any benefit it grants.</p>
        <div class="report-box">
          <h3>Have a question about your account?</h3>
          <p>Our B2B team can help with applications, rebate queries, and voucher orders.</p>
          <a class="addr" href="mailto:b2b@ballylife.com">b2b@ballylife.com</a>
        </div>
      </section>

    </main>
  </div>

  <div class="page">
    <footer>
      <div class="brand">Ballylife</div>
      <p>These terms may be amended from time to time. The version published here is the one that applies.</p>
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

export function BusinessTermsPage({ onBack }: { onBack: () => void }) {
  return <PolicyPageFrame title="Ballylife for Business Terms" srcDoc={BUSINESS_TERMS_PAGE_HTML} onBack={onBack} />;
}
