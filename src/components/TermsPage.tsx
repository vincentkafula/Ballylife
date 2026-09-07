import { useRef } from "react";

// Rendered via an iframe's srcDoc for the same reason as ContactPage.tsx:
// this page's own <script> (scroll-spy nav highlighting, reading-progress
// bar) would never execute if injected through dangerouslySetInnerHTML,
// and the iframe keeps its bespoke typography/color system (Fraunces +
// Inter + JetBrains Mono, a warm paper/ink palette) fully isolated from
// the rest of the app.
const TERMS_PAGE_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Platform Terms - Ballylife</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,500;9..144,600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  :root{
    --ink:#14213D;
    --paper:#FBF7EF;
    --paper-dim:#F3EEE2;
    --amber:#E2984F;
    --teal:#1F6F64;
    --charcoal:#22252B;
    --line:#D8D2C4;
    --line-dark:rgba(251,247,239,0.18);
  }

  *{box-sizing:border-box;}
  html{scroll-behavior:smooth;}
  body{
    margin:0;
    background:var(--paper);
    color:var(--charcoal);
    font-family:'Inter',sans-serif;
    font-size:16px;
    line-height:1.6;
  }

  h1,h2,h3{
    font-family:'Fraunces',serif;
    font-weight:600;
    margin:0;
    color:var(--ink);
  }

  a{color:inherit;}

  .tag{
    font-family:'JetBrains Mono',monospace;
    font-size:0.72rem;
    letter-spacing:0.02em;
    color:var(--amber);
  }

  /* ===== Reading progress bar ===== */
  .progress-rail{position:fixed; top:0; left:0; right:0; height:3px; background:rgba(20,33,61,0.08); z-index:50;}
  .progress-fill{height:100%; width:0%; background:var(--amber); transition:width 0.1s linear;}

  /* ===== HERO ===== */
  .hero{
    background:var(--ink);
    color:var(--paper);
    padding:5rem 6vw 4.5rem;
    position:relative;
    overflow:hidden;
  }
  .hero-inner{
    max-width:760px;
    position:relative;
    z-index:2;
  }
  .hero .brand{
    font-family:'JetBrains Mono',monospace;
    font-size:0.8rem;
    letter-spacing:0.04em;
    color:var(--amber);
    margin-bottom:2.5rem;
    display:flex;
    align-items:center;
    gap:0.6rem;
  }
  .hero .brand::before{
    content:'';
    width:8px;height:8px;
    background:var(--amber);
    border-radius:50%;
    display:inline-block;
  }
  .hero h1{
    color:var(--paper);
    font-size:clamp(2.4rem,5.4vw,4rem);
    line-height:1.06;
    font-weight:600;
    max-width:13ch;
  }
  .hero p.lede{
    margin-top:1.6rem;
    max-width:48ch;
    font-size:1.08rem;
    color:rgba(251,247,239,0.78);
    font-weight:400;
  }

  .stub{
    margin-top:2.8rem;
    display:inline-flex;
    align-items:center;
    gap:0.9rem;
    background:transparent;
    border:1.5px dashed rgba(226,152,79,0.55);
    padding:0.85rem 1.4rem;
    transform:rotate(-1.2deg);
  }
  .stub .stamp{
    font-family:'Fraunces',serif;
    font-weight:600;
    font-size:1rem;
    color:var(--amber);
    letter-spacing:0.03em;
    white-space:nowrap;
  }
  .stub .stamp-sub{
    font-family:'JetBrains Mono',monospace;
    font-size:0.68rem;
    color:rgba(251,247,239,0.6);
    border-left:1px solid rgba(251,247,239,0.25);
    padding-left:0.9rem;
    line-height:1.4;
  }

  .hero-route{
    position:absolute;
    right:-4%;
    top:0;
    bottom:0;
    width:44%;
    opacity:0.5;
    z-index:1;
  }

  /* ===== LAYOUT ===== */
  .layout{
    display:grid;
    grid-template-columns:280px 1fr;
    max-width:1180px;
    margin:0 auto;
    padding:0 6vw;
  }

  .index-rail{
    padding-top:3.5rem;
    position:sticky;
    top:0;
    align-self:start;
    max-height:100vh;
    overflow-y:auto;
  }
  .index-rail .index-label{
    font-family:'JetBrains Mono',monospace;
    font-size:0.68rem;
    color:#8A8577;
    margin-bottom:1.1rem;
    padding-bottom:0.7rem;
    border-bottom:1px solid var(--line);
  }
  .index-rail ol{
    list-style:none;
    margin:0;
    padding:0;
  }
  .index-rail > ol > li{
    margin-bottom:0.2rem;
  }
  .index-rail a{
    display:flex;
    gap:0.7rem;
    align-items:baseline;
    text-decoration:none;
    padding:0.5rem 0;
    font-size:0.87rem;
    color:#5B5748;
    transition:color 0.15s ease;
  }
  .index-rail > ol > li > a{
    color:var(--ink);
    font-weight:600;
  }
  .index-rail a:hover{color:var(--amber);}
  .index-rail a.active{color:var(--amber);}
  .index-rail a .code{
    font-family:'JetBrains Mono',monospace;
    font-size:0.68rem;
    color:var(--amber);
    flex-shrink:0;
  }
  .sub-index{
    list-style:none;
    margin:0 0 0.5rem;
    padding:0 0 0 1.35rem;
    border-left:1px solid var(--line);
  }
  .sub-index li{margin:0;}
  .sub-index a{
    padding:0.32rem 0;
    font-size:0.81rem;
    font-weight:400;
    color:#7A7566;
  }
  .sub-index a .code{color:#B7997A;}
  .sub-index a.active{color:var(--amber); font-weight:600;}

  main{
    padding:3.5rem 0 6rem 3.2rem;
    border-left:1px solid var(--line);
    max-width:700px;
  }

  section.clause{
    padding:2.6rem 0;
    border-bottom:1px solid var(--line);
    scroll-margin-top:1.5rem;
  }
  section.clause:first-child{padding-top:0;}
  section.clause:last-child{border-bottom:none;}

  .clause-head{
    display:flex;
    align-items:baseline;
    gap:0.9rem;
    margin-bottom:0.9rem;
  }
  .clause-head .code{
    font-family:'JetBrains Mono',monospace;
    font-size:0.75rem;
    color:var(--amber);
    flex-shrink:0;
  }
  .clause-head h2{
    font-size:1.6rem;
    line-height:1.25;
  }
  .clause h3{
    font-family:'Inter',sans-serif;
    font-weight:600;
    font-size:1rem;
    color:var(--ink);
    margin:1.6rem 0 0.5rem;
    scroll-margin-top:1.5rem;
  }
  .clause h3 .code{
    font-family:'JetBrains Mono',monospace;
    font-weight:500;
    font-size:0.72rem;
    color:var(--amber);
    margin-right:0.5rem;
  }
  .clause p{
    margin:0 0 0.9rem;
    color:#3A3D42;
    max-width:62ch;
  }
  .clause p:last-child{margin-bottom:0;}

  .checklist{
    list-style:none;
    margin:0.6rem 0 0;
    padding:0;
  }
  .checklist li{
    display:flex;
    gap:0.7rem;
    padding:0.55rem 0;
    border-bottom:1px dashed var(--line);
    font-size:0.95rem;
    color:#3A3D42;
  }
  .checklist li:last-child{border-bottom:none;}
  .checklist li::before{
    content:'\2713';
    color:var(--teal);
    font-weight:700;
    flex-shrink:0;
  }

  .plain-list{
    margin:0.6rem 0 0;
    padding-left:1.1rem;
    color:#3A3D42;
  }
  .plain-list li{margin-bottom:0.4rem;}

  .callout{
    background:var(--paper-dim);
    border-left:3px solid var(--amber);
    padding:1rem 1.2rem;
    margin-top:1rem;
    font-size:0.92rem;
    color:#4A4636;
  }

  .example{
    background:#fff;
    border:1px solid var(--line);
    padding:0.9rem 1.1rem;
    margin-top:0.7rem;
    font-size:0.9rem;
    color:#4A4636;
  }
  .example .ex-label{
    font-family:'JetBrains Mono',monospace;
    font-size:0.65rem;
    color:var(--teal);
    display:block;
    margin-bottom:0.4rem;
  }

  .inline-link{
    color:var(--teal);
    text-decoration:underline;
    text-decoration-color:rgba(31,111,100,0.35);
  }

  /* ===== FOOTER ===== */
  footer{
    background:var(--ink);
    color:rgba(251,247,239,0.7);
    padding:3.5rem 6vw;
    margin-top:2rem;
  }
  footer .footer-inner{
    max-width:1180px;
    margin:0 auto;
    display:flex;
    justify-content:space-between;
    align-items:center;
    flex-wrap:wrap;
    gap:1.5rem;
  }
  footer h3{
    color:var(--paper);
    font-size:1.3rem;
    font-weight:500;
  }
  footer p{
    margin:0.4rem 0 0;
    font-size:0.9rem;
    max-width:36ch;
  }
  .help-link{
    font-family:'JetBrains Mono',monospace;
    font-size:0.82rem;
    color:var(--amber);
    text-decoration:none;
    border-bottom:1px solid rgba(226,152,79,0.4);
    padding-bottom:0.2rem;
  }

  /* ===== MOBILE ===== */
  @media (max-width:860px){
    .layout{grid-template-columns:1fr;}
    .index-rail{
      position:relative;
      max-height:none;
      padding-top:2rem;
      overflow:visible;
    }
    main{
      padding:2.5rem 0 4rem 0;
      border-left:none;
      max-width:100%;
    }
    .hero{padding:3.2rem 6vw 3rem;}
    .hero-route{display:none;}
    footer .footer-inner{flex-direction:column;align-items:flex-start;}
  }

  @media (prefers-reduced-motion:reduce){
    html{scroll-behavior:auto;}
  }

  :focus-visible{
    outline:2px solid var(--amber);
    outline-offset:2px;
  }
</style>
</head>
<body>

<div class="progress-rail"><div class="progress-fill" id="progress-fill"></div></div>

<header class="hero">
  <div class="hero-inner">
    <div class="brand">BALLYLIFE</div>
    <h1>Terms of our platform.</h1>
    <p class="lede">How Ballylife works, what you can expect from us, what we expect from you -- including how returns work, all in one place.</p>
    <div class="stub">
      <span class="stamp">FREE RETURNS</span>
      <span class="stamp-sub">see T.04<br>below</span>
    </div>
  </div>
  <svg class="hero-route" viewBox="0 0 400 500" preserveAspectRatio="xMaxYMid slice" xmlns="http://www.w3.org/2000/svg">
    <path d="M 380 20 C 300 100, 340 180, 260 250 S 180 380, 90 470" stroke="rgba(226,152,79,0.35)" stroke-width="1.5" stroke-dasharray="2 8" fill="none" stroke-linecap="round"/>
    <circle cx="380" cy="20" r="4" fill="rgba(226,152,79,0.6)"/>
    <circle cx="260" cy="250" r="4" fill="rgba(226,152,79,0.6)"/>
    <circle cx="90" cy="470" r="4" fill="rgba(226,152,79,0.6)"/>
  </svg>
</header>

<div class="layout">
  <nav class="index-rail" aria-label="Terms index">
    <div class="index-label">TERMS INDEX</div>
    <ol>
      <li>
        <a href="#t01"><span class="code">T.01</span>Ordering on our platform</a>
        <ol class="sub-index">
          <li><a href="#t01-1">Create an account</a></li>
          <li><a href="#t01-2">Start shopping</a></li>
          <li><a href="#t01-3">Who you're buying from</a></li>
          <li><a href="#t01-4">Cancelling an order or item</a></li>
          <li><a href="#t01-5">Age-restricted items</a></li>
          <li><a href="#t01-6">Discount deals</a></li>
          <li><a href="#t01-7">Gift vouchers</a></li>
          <li><a href="#t01-8">Coupons</a></li>
        </ol>
      </li>
      <li>
        <a href="#t02"><span class="code">T.02</span>Paying for your order</a>
        <ol class="sub-index">
          <li><a href="#t02-1">How to pay</a></li>
          <li><a href="#t02-2">Payment service providers</a></li>
        </ol>
      </li>
      <li>
        <a href="#t03"><span class="code">T.03</span>Receiving your order</a>
        <ol class="sub-index">
          <li><a href="#t03-1">Delivery options</a></li>
          <li><a href="#t03-2">Delivery fees</a></li>
          <li><a href="#t03-3">When we deliver</a></li>
          <li><a href="#t03-4">When a sale is final</a></li>
          <li><a href="#t03-5">Reselling items</a></li>
        </ol>
      </li>
      <li>
        <a href="#t04"><span class="code">T.04</span>Returning an item</a>
        <ol class="sub-index">
          <li><a href="#t04-1">Return window</a></li>
          <li><a href="#t04-2">Packing your return</a></li>
          <li><a href="#t04-3">Wrong, damaged or incomplete</a></li>
          <li><a href="#t04-4">Change of mind</a></li>
          <li><a href="#t04-5">Faulty items</a></li>
          <li><a href="#t04-6">Warranty items</a></li>
          <li><a href="#t04-7">Bundles and sets</a></li>
          <li><a href="#t04-8">Devices that store data</a></li>
          <li><a href="#t04-9">Sent back the wrong item</a></li>
          <li><a href="#t04-10">If we can't accept it</a></li>
          <li><a href="#t04-11">Drop-off or collection</a></li>
          <li><a href="#t04-12">Non-returnable items</a></li>
          <li><a href="#t04-13">Exchanges</a></li>
          <li><a href="#t04-14">Refunds and credit</a></li>
          <li><a href="#t04-15">Vouchers and coupons</a></li>
        </ol>
      </li>
      <li>
        <a href="#t05"><span class="code">T.05</span>How our platform works</a>
        <ol class="sub-index">
          <li><a href="#t05-1">We own the platform</a></li>
          <li><a href="#t05-2">Account security</a></li>
          <li><a href="#t05-3">Using our site responsibly</a></li>
        </ol>
      </li>
      <li>
        <a href="#t06"><span class="code">T.06</span>Using our platform</a>
        <ol class="sub-index">
          <li><a href="#t06-1">Secure shopping</a></li>
          <li><a href="#t06-2">Availability and accuracy</a></li>
          <li><a href="#t06-3">What others say</a></li>
          <li><a href="#t06-4">Keeping your device safe</a></li>
        </ol>
      </li>
      <li>
        <a href="#t07"><span class="code">T.07</span>Resolving disputes</a>
        <ol class="sub-index">
          <li><a href="#t07-1">Let's work it out together</a></li>
          <li><a href="#t07-2">If we can't reach agreement</a></li>
          <li><a href="#t07-3">About our agreement</a></li>
        </ol>
      </li>
      <li>
        <a href="#t08"><span class="code">T.08</span>Sending legal notices</a>
        <ol class="sub-index">
          <li><a href="#t08-1">Addresses for notices</a></li>
          <li><a href="#t08-2">Notices by hand or email</a></li>
          <li><a href="#t08-3">Company information</a></li>
          <li><a href="#t08-4">Lodging complaints</a></li>
        </ol>
      </li>
    </ol>
  </nav>

  <main>

    <section class="clause" id="t01">
      <div class="clause-head"><span class="code">T.01</span><h2>Ordering on our platform</h2></div>

      <h3 id="t01-1"><span class="code">01</span>Create an account</h3>
      <p>If you're an individual, you must be at least 18 years old and legally able to enter into contracts in South Africa to register a Ballylife account. Business accounts are available under our separate business terms. Either way, you warrant that the details you give us about yourself or your business are accurate and kept up to date.</p>

      <h3 id="t01-2"><span class="code">02</span>Start shopping</h3>
      <ul class="checklist">
        <li>Add items to your cart and go to checkout</li>
        <li>Pay, and you'll receive an order confirmation</li>
      </ul>
      <p>Your order is only complete once payment has gone through and you've received that confirmation. Adding something to your cart or wish list doesn't reserve it, and doesn't guarantee you can buy it later at the same price.</p>

      <h3 id="t01-3"><span class="code">03</span>Who you're buying from</h3>
      <p>Some items are sold by Ballylife directly; others by independent sellers on our marketplace. Where another seller is responsible, their store name appears on the product page -- if it doesn't, you're buying directly from us. Marketplace sellers are responsible for their own stock, invoicing, product accuracy, and getting items to us in time for delivery. Different sellers may list the same product at different prices, and each seller sets their own retail price on top of what they pay their supplier.</p>

      <h3 id="t01-4"><span class="code">04</span>Cancelling an order or item</h3>
      <p>We, or a seller, may cancel your order or an item in it at any time -- for example, if it's out of stock, payment wasn't completed under the terms of your chosen method, we find a pricing or listing error, or your account is under investigation for misuse. You can cancel your side of things too, using the cancel option on your order details page. Once you start a cancellation, it can't be reversed. Any amount paid for a cancelled order or item is refunded.</p>

      <h3 id="t01-5"><span class="code">05</span>Age-restricted items</h3>
      <p>Certain products -- such as alcohol or vaping items, where these are offered -- can only be sold and delivered to someone 18 or older. If we can't verify the age of you or whoever accepts delivery, we won't hand over the item, and we may ask for ID at the door.</p>

      <h3 id="t01-6"><span class="code">06</span>Discount deals</h3>
      <p>Sellers set their own pricing and deals, with the terms shown on the relevant product page. You must meet all the terms of a deal to qualify for it. Deals run for a limited time and may end early if the allocated stock sells out.</p>
      <p><strong>Bundles we put together</strong> may apply a discounted price to individual items within them. <strong>Pre-packed bundles</strong> carry a single discounted price for the whole bundle, not for the items inside it individually.</p>

      <h3 id="t01-7"><span class="code">07</span>Gift vouchers</h3>
      <p>Gift vouchers are valid for 3 years from issue and don't earn interest. Redeeming one credits the full value to your account as non-refundable credit, which you can put toward a full or partial payment -- pay any balance owing another way. Some vouchers carry extra conditions printed on them; those apply too. Once a voucher's been delivered to the email address you gave us, we're not responsible for loss, unauthorised use, or sharing.</p>
      <div class="callout">You can't use a voucher to buy another voucher or a subscription, and vouchers can't be returned for a refund or swapped for cash.</div>

      <h3 id="t01-8"><span class="code">08</span>Coupons</h3>
      <p>You'll need a verified mobile number on your account to use coupons -- not every international number can be verified. Coupons may apply to any item or to specific products or categories, and may take off a fixed amount or a percentage. Each coupon can only be used once, and only one per order, applied at checkout. If a coupon doesn't cover your whole order, pay the rest another way.</p>
      <div class="callout">Coupons can't be used to buy airtime or vouchers, can't be exchanged for cash, and aren't refundable. We may correct, cancel, or decline a coupon at any time, including for misuse.</div>
    </section>

    <section class="clause" id="t02">
      <div class="clause-head"><span class="code">T.02</span><h2>Paying for your order</h2></div>

      <h3 id="t02-1"><span class="code">01</span>How to pay</h3>
      <p>Pay using any method offered at checkout. You must be authorised to make a payment on behalf of the account holder if it isn't your own account.</p>

      <h3 id="t02-2"><span class="code">02</span>Payment service providers</h3>
      <p>Each payment provider has its own terms and conditions, which you accept when you choose that method at checkout. The provider is responsible for the security of your payment method and any personal information you share with them during that process.</p>
    </section>

    <section class="clause" id="t03">
      <div class="clause-head"><span class="code">T.03</span><h2>Receiving your order</h2></div>

      <h3 id="t03-1"><span class="code">01</span>Delivery options</h3>
      <p>Choose delivery to an address, subject to availability in your country. We need a correct delivery address to make sure delivery goes smoothly, and to correctly calculate any applicable tax and import duty for your country. Age-restricted and large items must be delivered to a physical address.</p>

      <h3 id="t03-2"><span class="code">02</span>Delivery fees</h3>
      <p>We may charge a fee to deliver to your address. The fee is shown at checkout, and we may change it at any time without notice.</p>

      <h3 id="t03-3"><span class="code">03</span>When we deliver</h3>
      <p>Delivery times vary depending on the items you order, whether they ship locally or are imported through one of our supplier partners, your payment method, and your location. We show delivery estimates on product pages to help you shop, but always check the estimated date at checkout for the most accurate picture. Your order is considered delivered once someone accepts it at your chosen delivery address -- make sure anyone accepting on your behalf has your permission to do so.</p>

      <h3 id="t03-4"><span class="code">04</span>When a sale is final</h3>
      <p>Once you've paid and we've delivered the item, it's officially yours to enjoy and care for.</p>

      <h3 id="t03-5"><span class="code">05</span>Reselling items</h3>
      <p class="callout">Items bought on Ballylife are for your own use. Reselling them may result in your account being suspended or closed and any pending orders cancelled.</p>
    </section>

    <section class="clause" id="t04">
      <div class="clause-head"><span class="code">T.04</span><h2>Returning an item</h2></div>
      <p>We want you to be happy with every order. If something isn't right, you can send it back for a replacement, an exchange, or a credit or refund to your Ballylife account -- and returns are free.</p>

      <h3 id="t04-1"><span class="code">01</span>Return window</h3>
      <p>Orders that arrive wrong, damaged, incomplete, or that you've simply changed your mind about can be sent back within <strong>30 days of delivery</strong>. Faulty items have a longer window -- you have <strong>6 months from delivery</strong> to report a fault and start a return.</p>

      <h3 id="t04-2"><span class="code">02</span>Packing your return</h3>
      <p>Pack items securely so they aren't damaged on the way back to us.</p>
      <ul class="checklist">
        <li>Original packaging, unused and with tags still attached</li>
        <li>All accessories and parts included</li>
        <li>Any seals that came with the product left intact</li>
      </ul>
      <p class="callout">If something's missing, we may have to send the item back to you. You're welcome to try again once you have the missing pieces, though a collection or delivery fee may apply.</p>

      <h3 id="t04-3"><span class="code">03</span>Wrong, damaged or incomplete</h3>
      <p>If we sent the wrong product, it arrived damaged, or parts are missing, let us know within 30 days. We'll offer a replacement, account credit, or a refund -- your choice, stock permitting.</p>
      <p>Not treated as delivery damage if: the damage happened after delivery, it was caused by a power surge, or the item works as described but was used for something it wasn't designed for.</p>

      <h3 id="t04-4"><span class="code">04</span>Change of mind</h3>
      <p>Not what you expected? You can return it within 30 days of delivery, provided it meets the packing conditions above and isn't on our non-returnable list.</p>

      <h3 id="t04-5"><span class="code">05</span>Faulty items</h3>
      <p>Report faults within 6 months of delivery. Once we've inspected the item, if the return is approved you can choose between a repair, replacement, account credit, or refund, subject to what's realistically possible for that product.</p>
      <p>Not covered: normal wear and tear, misuse or lack of care, power surges or corrosion, unauthorised modification, or use outside the product's intended purpose.</p>

      <h3 id="t04-6"><span class="code">06</span>Warranty items</h3>
      <p><strong>Extended warranties.</strong> Some products carry a warranty longer than our standard 6-month window -- check the product page. If something breaks after 6 months, tell us straight away and we'll arrange a free return to the supplier for assessment (an evaluation fee may apply). If they can't repair or replace it within 21 days of receiving it, we'll step in with a credit or refund.</p>
      <p><strong>Manufacturer-handled warranties.</strong> For products where the manufacturer deals with returns directly, we'll give you their contact details so you can reach out to them.</p>

      <h3 id="t04-7"><span class="code">07</span>Bundles and sets</h3>
      <p>For bundles we put together ourselves, you can return the whole bundle or just one item, and we'll credit you for what you paid. For sets pre-packed by a supplier, you'll generally need to return every item together -- we may decline a partial return unless the product page says otherwise.</p>

      <h3 id="t04-8"><span class="code">08</span>Devices that store data</h3>
      <p>If you're returning a device that holds your data, we'll need any passcodes or unlock codes to assess it -- without them, we may not be able to process the return. Assessing your device could involve a factory reset, so please back up anything important first.</p>

      <h3 id="t04-9"><span class="code">09</span>Sent back the wrong item</h3>
      <p>Please double-check what you're sending. If you accidentally return the wrong item, contact us immediately -- incorrectly returned items are disposed of after a period, so we can't guarantee recovery and won't be liable for anything lost this way.</p>

      <h3 id="t04-10"><span class="code">10</span>If we can't accept it</h3>
      <p>If a return doesn't qualify, we'll send the item back to you. If we can't deliver it within 30 days -- for example, because we can't reach you or delivery is refused -- we'll treat the item as abandoned and may dispose of it.</p>

      <h3 id="t04-11"><span class="code">11</span>Drop-off or collection</h3>
      <p>When you start a return, we'll arrange for collection of the item from your delivery address. Collections need to be scheduled within 7 days of logging the return. Bulky or restricted items follow the same collection process as everything else.</p>

      <h3 id="t04-12"><span class="code">12</span>Non-returnable items</h3>
      <p>Products marked non-returnable on their product page generally can't be sent back, except where we made an error, the item is damaged, or it's genuinely faulty. If you're not sure, just ask and we'll work it out together.</p>
      <ul class="plain-list">
        <li>Underwear, swimwear, and jewellery, for hygiene reasons</li>
        <li>Unsealed software, and opened audio or video media</li>
        <li>Personalised or custom-made items</li>
        <li>Vehicles, once registered or delivered -- see our separate Vehicle Purchase Terms</li>
      </ul>

      <h3 id="t04-13"><span class="code">13</span>Exchanges</h3>
      <p>Wrong size or colour? Clothing, footwear, and sportswear can be exchanged for a different size or colour, subject to availability.</p>

      <h3 id="t04-14"><span class="code">14</span>Refunds and credit</h3>
      <p>When you log a return, tell us whether you'd like a refund, account credit, or a replacement. Credit lands in your Ballylife account within 2 business days of approval and stays valid for 3 years. Refunds go back via your original payment method and typically take 3-5 business days, depending on your bank.</p>
      <p class="callout">If we can't refund your original method, we'll ask for your bank details and verify them first, which may take a little longer. Any donation added to your original order will be deducted from the refund or credit amount.</p>

      <h3 id="t04-15"><span class="code">15</span>Vouchers and coupons</h3>
      <p>If part of your order was paid with a voucher, that portion returns to you as non-refundable account credit -- you can choose a refund or credit for the rest. If you paid with a coupon, we'll issue a new coupon for the amount used, and you can choose a refund or credit for the remaining balance.</p>
      <div class="example">
        <span class="ex-label">EXAMPLE</span>
        A R100 voucher used toward a R500 item that's returned: R100 becomes non-refundable credit, and you choose a refund or credit for the remaining R400.
      </div>
    </section>

    <section class="clause" id="t05">
      <div class="clause-head"><span class="code">T.05</span><h2>How our platform works</h2></div>

      <h3 id="t05-1"><span class="code">01</span>We own the platform</h3>
      <p>Ballylife owns and operates this platform. Using it gives you permission to browse and shop -- not ownership of the platform or its content, which belongs to us, our sellers, or our licensors, and is protected by law. You may not use, distribute, or reproduce that content without the owner's written consent. We may change, suspend, or terminate the platform at any time, without notice.</p>

      <h3 id="t05-2"><span class="code">02</span>Account security</h3>
      <p>Keep your login details private. You carry the risk of unauthorised or fraudulent activity on your account, so tell us immediately if you suspect a breach, and change your password and block affected cards straight away. We may suspend or close your account at any time, for any reason.</p>

      <h3 id="t05-3"><span class="code">03</span>Using our site responsibly</h3>
      <p>You agree not to interfere with how the platform operates, use bots, spiders, or scrapers against it (aside from standard search-engine indexing), or post anything defamatory, hateful, or otherwise unlawful.</p>
    </section>

    <section class="clause" id="t06">
      <div class="clause-head"><span class="code">T.06</span><h2>Using our platform</h2></div>

      <h3 id="t06-1"><span class="code">01</span>Secure shopping</h3>
      <p>We work hard to keep the platform secure and reliable, but some risk is inherent to shopping online and outside our control. You use the platform at your own risk, and we're not liable for loss or damage arising from that use, except where the law says otherwise. Shop safely by keeping your account details secure, reading product descriptions carefully, and contacting us with any concerns.</p>

      <h3 id="t06-2"><span class="code">02</span>Availability and accuracy</h3>
      <p>We aim to keep the site available day and night, and its information -- pricing, availability, delivery costs, tax and duty estimates -- accurate and up to date. Mistakes do happen; we'll fix them as quickly as we can once we know, and ask for your patience in the meantime. We're not liable for loss arising from such errors, except where the law says otherwise.</p>

      <h3 id="t06-3"><span class="code">03</span>What others say</h3>
      <p>Reviews, seller descriptions, and other user content reflect the views of whoever posted them, not ours. We're not responsible for what others say or post on the platform, so use your own judgment when reading it.</p>

      <h3 id="t06-4"><span class="code">04</span>Keeping your device safe</h3>
      <p>We take steps to keep the platform free of viruses and malware, and recommend you do the same -- keep security software updated, be cautious with downloads, and trust your instincts if something looks off. There are some security risks inherent to browsing the internet that are outside our control, unless an issue results from a serious mistake or wrongdoing on our part.</p>
    </section>

    <section class="clause" id="t07">
      <div class="clause-head"><span class="code">T.07</span><h2>Resolving disputes</h2></div>

      <h3 id="t07-1"><span class="code">01</span>Let's work it out together</h3>
      <p>If something goes wrong, start by contacting our support team via the Help Centre -- most issues are sorted out this way.</p>

      <h3 id="t07-2"><span class="code">02</span>If we can't reach agreement</h3>
      <p>These terms, and any dispute arising from them, are governed by South African law. You and we agree that the High Court of South Africa (Western Cape Division, Cape Town) has jurisdiction over any legal matter between us, even where the amount involved would usually go to a lower court. Our goal is always to resolve issues before they become formal disputes, so please reach out to us first.</p>

      <h3 id="t07-3"><span class="code">03</span>About our agreement</h3>
      <p>Together, these Terms of our Platform, our Privacy Policy, the payment terms shown at checkout, and anything else we say applies (for example, in our Help Centre) form our full agreement. If these terms ever conflict with another document, these terms apply first unless we say otherwise.</p>
      <p>We may update any part of this agreement at any time, and changes take effect once published on the platform -- continuing to use Ballylife after that means you accept the change. If a court finds part of this agreement unenforceable, the rest still stands. Not enforcing a right immediately doesn't mean we've given it up. You may not transfer your rights or obligations under this agreement to someone else.</p>
    </section>

    <section class="clause" id="t08">
      <div class="clause-head"><span class="code">T.08</span><h2>Sending legal notices</h2></div>

      <h3 id="t08-1"><span class="code">01</span>Addresses for notices</h3>
      <p>Send legal notices in writing to our head office at <em>[registered office address]</em>, or by email to <a class="inline-link" href="mailto:legal@ballylife.com">legal@ballylife.com</a>. We may update these addresses on the platform. We'll send notices to you at the most recent email or delivery address saved on your account -- keep these up to date.</p>

      <h3 id="t08-2"><span class="code">02</span>Notices by hand or email</h3>
      <p>Notices delivered by hand count as received on the day of delivery. Notices sent by email count as received on the day they're sent.</p>

      <h3 id="t08-3"><span class="code">03</span>Company information</h3>
      <p>
        Registered name: <em>[Ballylife legal entity name]</em><br>
        Registration number: <em>[company registration number]</em><br>
        Main business: Online retail and marketplace<br>
        Email: legal@ballylife.com<br>
        Phone: <em>[customer support number]</em><br>
        Physical address: <em>[registered office address]</em>
      </p>

      <h3 id="t08-4"><span class="code">04</span>Lodging complaints</h3>
      <p>Raise a complaint about goods or services via our Help Centre or by phone. If it isn't resolved to your satisfaction, you can escalate it to the Consumer Goods and Services Ombud (CGSO) at cgso.org.za, on 0860 000 272, or at info@cgso.org.za.</p>
    </section>

  </main>
</div>

<footer>
  <div class="footer-inner">
    <div>
      <h3>Questions about these terms?</h3>
      <p>Our support team can walk you through any part of this, including a return.</p>
    </div>
    <a class="help-link" href="#">Visit the Help Centre</a>
  </div>
</footer>

<script>
  (function(){
    // Reading progress bar -- fills as the whole document is scrolled.
    var fill = document.getElementById('progress-fill');
    function updateProgress(){
      var scrollTop = window.scrollY || document.documentElement.scrollTop;
      var height = document.documentElement.scrollHeight - document.documentElement.clientHeight;
      var pct = height > 0 ? (scrollTop / height) * 100 : 0;
      fill.style.width = pct + '%';
    }
    window.addEventListener('scroll', updateProgress, { passive: true });
    updateProgress();

    // Scroll-spy -- highlights whichever section/sub-section is
    // currently in view in the sticky index rail, so the long list of
    // clauses stays orientating rather than just a static table of
    // contents.
    var sections = Array.prototype.slice.call(document.querySelectorAll('main [id]'));
    var navLinks = Array.prototype.slice.call(document.querySelectorAll('.index-rail a'));

    function setActive(id){
      navLinks.forEach(function(link){
        var isMatch = link.getAttribute('href') === '#' + id;
        link.classList.toggle('active', isMatch);
      });
    }

    if ('IntersectionObserver' in window){
      var observer = new IntersectionObserver(function(entries){
        var visible = entries.filter(function(e){ return e.isIntersecting; });
        if (visible.length){
          // Prefer the entry closest to the top of the viewport among
          // those currently visible, so a short clause doesn't lose the
          // highlight to a much taller neighbour scrolling past it.
          visible.sort(function(a,b){ return a.boundingClientRect.top - b.boundingClientRect.top; });
          setActive(visible[0].target.id);
        }
      }, { rootMargin: '-15% 0px -70% 0px', threshold: 0 });
      sections.forEach(function(s){ observer.observe(s); });
    }
  })();
</script>

</body>
</html>`;

export function TermsPage({ onBack }: { onBack: () => void }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-2.5 border-b border-gray-100 bg-white shrink-0">
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-800">&larr; Back to shopping</button>
      </div>
      <iframe
        ref={iframeRef}
        title="Ballylife Platform Terms"
        srcDoc={TERMS_PAGE_HTML}
        className="flex-1 w-full border-0"
        style={{ minHeight: 0 }}
      />
    </div>
  );
}
