import { PolicyPageFrame } from "./PolicyPageFrame";

// No <script> in the supplied design (the sticky index rail and
// smooth-scroll anchors are pure CSS), but still rendered via an
// iframe's srcDoc for the same reason as the other standalone pages:
// full isolation of this page's own typography/color system (Fraunces +
// Inter + JetBrains Mono, the same warm ink/amber palette as the
// Platform Terms page it's a sibling document to) from the rest of the app.
const BALLYLIFEMORE_PAGE_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>BallylifeMORE Subscription Terms - Ballylife</title>
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

  .code{
    font-family:'JetBrains Mono',monospace;
    font-size:0.72rem;
    color:var(--amber);
  }

  .hero{
    background:var(--ink);
    color:var(--paper);
    padding:5rem 6vw 4rem;
    position:relative;
    overflow:hidden;
  }
  .hero-inner{max-width:740px; position:relative; z-index:2;}
  .hero .brand{
    font-family:'JetBrains Mono',monospace;
    font-size:0.8rem;
    letter-spacing:0.04em;
    color:var(--amber);
    margin-bottom:2.4rem;
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
    font-size:clamp(2.3rem,5vw,3.7rem);
    line-height:1.1;
    font-weight:600;
    max-width:14ch;
  }
  .hero p.lede{
    margin-top:1.5rem;
    max-width:50ch;
    font-size:1.06rem;
    color:rgba(251,247,239,0.78);
  }

  .plan-strip{
    margin-top:2.6rem;
    display:flex;
    gap:1rem;
    flex-wrap:wrap;
  }
  .plan-pill{
    border:1px solid rgba(226,152,79,0.4);
    padding:0.7rem 1.2rem;
    display:flex;
    flex-direction:column;
    gap:0.2rem;
  }
  .plan-pill .p-name{
    font-family:'Fraunces',serif;
    font-weight:600;
    font-size:1rem;
    color:var(--amber);
  }
  .plan-pill .p-note{
    font-family:'JetBrains Mono',monospace;
    font-size:0.68rem;
    color:rgba(251,247,239,0.55);
  }

  .hero-route{
    position:absolute;
    right:-4%;
    top:0;
    bottom:0;
    width:40%;
    opacity:0.45;
    z-index:1;
  }

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
  .index-rail ol{list-style:none; margin:0; padding:0;}
  .index-rail > ol > li{margin-bottom:0.2rem;}
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
  .index-rail > ol > li > a{color:var(--ink); font-weight:600;}
  .index-rail a:hover{color:var(--amber);}
  .index-rail a .code{flex-shrink:0;}
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
  .sub-index a .code{color:#C6A87F;}

  main{
    padding:3.5rem 0 6rem 3.2rem;
    border-left:1px solid var(--line);
    max-width:700px;
  }

  section.clause{padding:2.6rem 0; border-bottom:1px solid var(--line);}
  section.clause:first-child{padding-top:0;}
  section.clause:last-child{border-bottom:none;}

  .clause-head{display:flex; align-items:baseline; gap:0.9rem; margin-bottom:0.9rem;}
  .clause-head h2{font-size:1.55rem; line-height:1.25;}
  .clause h3{
    font-family:'Inter',sans-serif;
    font-weight:600;
    font-size:1rem;
    color:var(--ink);
    margin:1.5rem 0 0.5rem;
    scroll-margin-top:1.5rem;
  }
  .clause h3 .code{font-weight:500; margin-right:0.5rem;}
  .clause p{margin:0 0 0.9rem; color:#3A3D42; max-width:62ch;}
  .clause p:last-child{margin-bottom:0;}

  .plain-list{margin:0.6rem 0 0; padding-left:1.1rem; color:#3A3D42;}
  .plain-list li{margin-bottom:0.4rem;}

  .checklist{list-style:none; margin:0.6rem 0 0; padding:0;}
  .checklist li{
    display:flex; gap:0.7rem; padding:0.55rem 0;
    border-bottom:1px dashed var(--line);
    font-size:0.95rem; color:#3A3D42;
  }
  .checklist li:last-child{border-bottom:none;}
  .checklist li::before{content:'\2713'; color:var(--teal); font-weight:700; flex-shrink:0;}

  .callout{
    background:var(--paper-dim);
    border-left:3px solid var(--amber);
    padding:1rem 1.2rem;
    margin-top:1rem;
    font-size:0.92rem;
    color:#4A4636;
  }
  .callout.right{border-left-color:var(--teal);}

  .fee-table{
    width:100%;
    border-collapse:collapse;
    margin-top:1rem;
    font-size:0.9rem;
  }
  .fee-table th, .fee-table td{
    text-align:left;
    padding:0.7rem 0.9rem;
    border:1px solid var(--line);
  }
  .fee-table th{
    background:var(--paper-dim);
    font-family:'JetBrains Mono',monospace;
    font-size:0.68rem;
    color:#5B5748;
    font-weight:500;
  }
  .fee-table td em{color:#8A8577;}

  footer{
    background:var(--ink);
    color:rgba(251,247,239,0.7);
    padding:3.5rem 6vw;
    margin-top:2rem;
  }
  footer .footer-inner{
    max-width:1180px; margin:0 auto;
    display:flex; justify-content:space-between; align-items:center;
    flex-wrap:wrap; gap:1.5rem;
  }
  footer h3{color:var(--paper); font-size:1.25rem; font-weight:500;}
  footer p{margin:0.4rem 0 0; font-size:0.9rem; max-width:36ch;}
  .help-link{
    font-family:'JetBrains Mono',monospace;
    font-size:0.82rem;
    color:var(--amber);
    text-decoration:none;
    border-bottom:1px solid rgba(226,152,79,0.4);
    padding-bottom:0.2rem;
  }

  @media (max-width:860px){
    .layout{grid-template-columns:1fr;}
    .index-rail{position:relative; max-height:none; padding-top:2rem; overflow:visible;}
    main{padding:2.5rem 0 4rem 0; border-left:none; max-width:100%;}
    .hero{padding:3.2rem 6vw 3rem;}
    .hero-route{display:none;}
    .fee-table{font-size:0.82rem;}
    footer .footer-inner{flex-direction:column; align-items:flex-start;}
  }

  @media (prefers-reduced-motion:reduce){html{scroll-behavior:auto;}}
  :focus-visible{outline:2px solid var(--amber); outline-offset:2px;}
</style>
</head>
<body>

<header class="hero">
  <div class="hero-inner">
    <div class="brand">BALLYLIFE - BALLYLIFEMORE</div>
    <h1>BallylifeMORE subscription terms.</h1>
    <p class="lede">The rules behind your BallylifeMORE subscription -- what you get, what it costs, and how to change your mind at any point.</p>
    <div class="plan-strip">
      <div class="plan-pill"><span class="p-name">Standard</span><span class="p-note">MONTH-TO-MONTH</span></div>
      <div class="plan-pill"><span class="p-name">Premium</span><span class="p-note">MONTH-TO-MONTH</span></div>
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
  <nav class="index-rail" aria-label="BallylifeMORE terms index">
    <div class="index-label">BALLYLIFEMORE INDEX</div>
    <ol>
      <li><a href="#m01"><span class="code">M.01</span>Introduction</a></li>
      <li>
        <a href="#m02"><span class="code">M.02</span>Eligibility</a>
        <ol class="sub-index">
          <li><a href="#m02-1">Who can join</a></li>
          <li><a href="#m02-2">Subscriber rules</a></li>
          <li><a href="#m02-3">Our discretion to accept</a></li>
        </ol>
      </li>
      <li>
        <a href="#m03"><span class="code">M.03</span>Plans and benefits</a>
        <ol class="sub-index">
          <li><a href="#m03-1">Two plans</a></li>
          <li><a href="#m03-2">Limits on benefits</a></li>
          <li><a href="#m03-3">Linked partner accounts</a></li>
          <li><a href="#m03-4">Unused benefits</a></li>
          <li><a href="#m03-5">Changes to benefits</a></li>
        </ol>
      </li>
      <li><a href="#m04"><span class="code">M.04</span>Free trial</a></li>
      <li>
        <a href="#m05"><span class="code">M.05</span>Billing</a>
        <ol class="sub-index">
          <li><a href="#m05-1">Commencement and billing date</a></li>
          <li><a href="#m05-2">Authorisation to charge</a></li>
          <li><a href="#m05-3">Late or missed payment</a></li>
          <li><a href="#m05-4">Invoices</a></li>
        </ol>
      </li>
      <li><a href="#m06"><span class="code">M.06</span>Upgrading or downgrading</a></li>
      <li>
        <a href="#m07"><span class="code">M.07</span>Cancellation</a>
        <ol class="sub-index">
          <li><a href="#m07-1">Cancelling anytime</a></li>
          <li><a href="#m07-2">Cooling-off period</a></li>
          <li><a href="#m07-3">How to cancel</a></li>
          <li><a href="#m07-4">Non-payment vs. cancellation</a></li>
          <li><a href="#m07-5">Our right to terminate</a></li>
        </ol>
      </li>
      <li><a href="#m08"><span class="code">M.08</span>Changes to these terms</a></li>
      <li><a href="#m09"><span class="code">M.09</span>More Deals</a></li>
      <li><a href="#m10"><span class="code">M.10</span>Subscription fee discounts</a></li>
      <li><a href="#m11"><span class="code">M.11</span>Privacy and marketing</a></li>
      <li><a href="#m12"><span class="code">M.12</span>General terms</a></li>
    </ol>
  </nav>

  <main>

    <section class="clause" id="m01">
      <div class="clause-head"><span class="code">M.01</span><h2>Introduction</h2></div>
      <p>These terms cover every subscription plan offered by Ballylife under the BallylifeMORE programme. They sit alongside our Terms of our Platform, Privacy Policy, and Returns Policy -- if you're a corporate buyer, your Ballylife for Business Terms apply instead of the eligibility rules below.</p>
      <p>Nothing here is meant to override your statutory rights. Pay close attention to the cooling-off, billing, and cancellation clauses in particular, since those affect your money most directly.</p>
    </section>

    <section class="clause" id="m02">
      <div class="clause-head"><span class="code">M.02</span><h2>Eligibility</h2></div>

      <h3 id="m02-1"><span class="code">01</span>Who can join</h3>
      <p>To subscribe to BallylifeMORE, you need to:</p>
      <ul class="checklist">
        <li>be 18 or older, if you're a natural person</li>
        <li>have a Ballylife account linked to a verified mobile number</li>
        <li>have an authenticated card linked to your account and selected for the subscription</li>
      </ul>
      <p>If you meet those, you can register from the Subscriptions tab in My Account. You become a Subscriber once your registration is accepted.</p>

      <h3 id="m02-2"><span class="code">02</span>Subscriber rules</h3>
      <p>You can't transfer your subscription or its benefits to someone else, or use subscriber benefits to buy items for resale. You can only hold one BallylifeMORE plan at a time -- to move between plans, see Upgrading or downgrading below.</p>

      <h3 id="m02-3"><span class="code">03</span>Our discretion to accept</h3>
      <p>We may accept or decline any registration at our discretion, even if you're eligible and have completed the sign-up process. We're not obliged to explain a decline.</p>
    </section>

    <section class="clause" id="m03">
      <div class="clause-head"><span class="code">M.03</span><h2>Plans and benefits</h2></div>

      <h3 id="m03-1"><span class="code">01</span>Two plans</h3>
      <p>BallylifeMORE offers Standard and Premium plans. The monthly fee and benefits for each are set out in our current benefits table, which forms part of these terms.</p>

      <h3 id="m03-2"><span class="code">02</span>Limits on benefits</h3>
      <p>Subscription benefits don't apply to every product, every delivery area, or every time of day. In particular:</p>
      <ul class="plain-list">
        <li>Same-day or next-day delivery depends on stock at nearby distribution centres</li>
        <li>Fast delivery cut-off times apply, and may be temporarily disabled during peak periods</li>
        <li>Only certain delivery areas qualify for same-day or next-day service</li>
        <li>If only some items in an order qualify, benefits apply only to those items -- the rest follow our standard Terms of our Platform</li>
      </ul>

      <h3 id="m03-3"><span class="code">03</span>Linked partner accounts</h3>
      <p>Where a benefit is delivered through a partner service, you'll need a linked account with that partner. You can link it yourself, or we may link it on your behalf with your consent -- but it stays your responsibility to make sure the right accounts are connected so you can actually use the benefit.</p>

      <h3 id="m03-4"><span class="code">04</span>Unused benefits</h3>
      <p>Monthly benefits don't roll over. Whatever you don't use in a Subscription Period is gone once that period ends.</p>

      <h3 id="m03-5"><span class="code">05</span>Changes to benefits</h3>
      <p>We may add, remove, or change benefits, adjust order minimums, or change the monthly fee at our discretion (a "Subscription Amendment"). We'll notify you in advance by email, SMS, or an in-app notice. If you're not happy with a change, you can cancel -- see Cancellation below.</p>
      <p class="callout">We can also temporarily disable any benefit for operational reasons, for as long as those reasons last.</p>
    </section>

    <section class="clause" id="m04">
      <div class="clause-head"><span class="code">M.04</span><h2>Free trial</h2></div>
      <p>First-time Subscribers get one free trial period, as set out in the benefits table, when they first register and we accept it. During the trial you get full access to your plan's benefits, and you can cancel at any time during it at no cost, in line with your cooling-off rights.</p>
      <p>Once the trial ends, the monthly fee becomes payable and your subscription continues month-to-month. If payment isn't received, you'll lose access to your benefits.</p>
      <div class="callout">Free trials are for first-time Subscribers only -- one per person, not one per plan. Registering under a different account or number doesn't create a new entitlement, and we decide eligibility at our discretion.</div>
    </section>

    <section class="clause" id="m05">
      <div class="clause-head"><span class="code">M.05</span><h2>Billing</h2></div>

      <h3 id="m05-1"><span class="code">01</span>Commencement and billing date</h3>
      <p>Your subscription starts once we accept your registration ("Commencement Date") and then runs month-to-month until it's cancelled by you or us. Except during a free trial, the monthly fee is owed in advance on the first day of each Subscription Period ("Billing Date") -- the same date every month, or the last day of the month if that date is the 31st.</p>

      <h3 id="m05-2"><span class="code">02</span>Authorisation to charge</h3>
      <p>By subscribing, you authorise us to automatically charge the monthly fee to your chosen payment method on record, without further notice unless the law requires it.</p>

      <h3 id="m05-3"><span class="code">03</span>Late or missed payment</h3>
      <p>If payment doesn't go through on the Billing Date, benefits are paused for that period. If we let benefits continue anyway, that's not a waiver of our right to remove them. If payment comes in after the Billing Date, the full fee is still owed for that period, without reduction, and benefits only apply for whatever's left of it.</p>

      <h3 id="m05-4"><span class="code">04</span>Invoices</h3>
      <p>Invoices for successful subscription payments are available under Payment History in My Account.</p>
    </section>

    <section class="clause" id="m06">
      <div class="clause-head"><span class="code">M.06</span><h2>Upgrading or downgrading</h2></div>
      <p>You can switch plans through your Subscription Dashboard. Switching during your free trial forfeits the trial if you're upgrading. After the trial:</p>
      <table class="fee-table">
        <tr><th>Direction</th><th>When it takes effect</th></tr>
        <tr><td>Upgrading</td><td>Immediately, once the new plan's fee is paid on the next Billing Date</td></tr>
        <tr><td>Downgrading</td><td>From the first day of the next Subscription Period</td></tr>
      </table>
      <p>You can't switch plans while you have an outstanding payment on your current one. A switch is treated as an amendment to your existing subscription, not a new agreement.</p>
    </section>

    <section class="clause" id="m07">
      <div class="clause-head"><span class="code">M.07</span><h2>Cancellation</h2></div>

      <h3 id="m07-1"><span class="code">01</span>Cancelling anytime</h3>
      <p>You can cancel at any time, without giving a reason. Cancellation takes effect at the end of your current Subscription Period, or 20 business days after you request it -- whichever comes first. You'll keep your benefits until then, so no refund is due for that period.</p>

      <h3 id="m07-2"><span class="code">02</span>Cooling-off period</h3>
      <p>You can cancel within 7 calendar days of your Commencement Date at no cost, with a full refund, provided you haven't used any benefits yet. If you have used a benefit, the standard cancellation terms above apply instead.</p>

      <h3 id="m07-3"><span class="code">03</span>How to cancel</h3>
      <p>Go to your Subscription Dashboard in My Account and follow the cancellation steps. To avoid the next month's charge, cancel before your next Billing Date.</p>

      <h3 id="m07-4"><span class="code">04</span>Non-payment vs. cancellation</h3>
      <p>Missing a payment doesn't cancel your subscription -- it only pauses your benefits until payment is received. After three consecutive missed Subscription Periods, though, we may terminate the subscription outright.</p>

      <h3 id="m07-5"><span class="code">05</span>Our right to terminate</h3>
      <p>We may end your subscription, or any part of it, at any time, giving 30 calendar days' notice, unless the law requires otherwise or shorter notice is reasonable in the circumstances. We may terminate immediately, without notice, if we determine you've broken these terms, the law, or misused the subscription. Not enforcing these terms strictly on one occasion doesn't waive our rights on another.</p>
    </section>

    <section class="clause" id="m08">
      <div class="clause-head"><span class="code">M.08</span><h2>Changes to these terms</h2></div>
      <p>Aside from Subscription Amendments (which always come with advance notice), we may update these terms at our discretion, as long as the change isn't material under consumer protection law. It's on you to check back periodically. If you're unhappy with a change, you can cancel at any time as described above.</p>
    </section>

    <section class="clause" id="m09">
      <div class="clause-head"><span class="code">M.09</span><h2>More Deals</h2></div>
      <p>Subscribers get access to limited-time "More Deals" pricing on selected products.</p>
      <ul class="plain-list">
        <li>Once a More Deal sells out, the product may still be available at its normal price</li>
        <li>Savings aren't guaranteed and are set at our discretion</li>
        <li>Limited to 4 units of each More Deal product per Subscriber</li>
        <li>Adding a More Deal to your cart doesn't reserve it -- payment must land within 25 hours of ordering, or the order is cancelled</li>
        <li>Stock is reserved in the order payment is received, so slower payment methods like EFT carry more risk of missing out</li>
        <li>More Deals are available during your free trial, and otherwise only while your subscription is paid up and benefits are active</li>
      </ul>
    </section>

    <section class="clause" id="m10">
      <div class="clause-head"><span class="code">M.10</span><h2>Subscription fee discounts</h2></div>
      <p>We may offer discounted subscription pricing to selected Subscribers at our discretion.</p>
      <ul class="plain-list">
        <li>Claim an offer manually from your Subscription Dashboard within its validity window</li>
        <li>Discounts take effect from your next Billing Date, even if claimed during a free trial</li>
        <li>Claiming a new offer forfeits any existing active offer</li>
        <li>Only one discount can be active per account, and it can't be combined with other offers unless we say so</li>
        <li>Discounts can't be transferred or shared between accounts</li>
        <li>Pricing reverts to normal automatically once a discount period ends</li>
      </ul>
      <p class="callout right">Cancelling your subscription during a discount period forfeits any remaining discount immediately -- it doesn't carry over if you resubscribe.</p>
    </section>

    <section class="clause" id="m11">
      <div class="clause-head"><span class="code">M.11</span><h2>Privacy and marketing</h2></div>
      <p>We handle your data as described in our Privacy Policy, which forms part of these terms. As a Subscriber, you agree to receive communications about your subscription and its benefits -- by email, SMS, WhatsApp, or in-app and push notifications -- from us and our benefits partners.</p>
    </section>

    <section class="clause" id="m12">
      <div class="clause-head"><span class="code">M.12</span><h2>General terms</h2></div>
      <p>Not enforcing a right under these terms on one occasion doesn't waive it for the future. If any clause is found invalid, the rest remains in force. These terms are the whole agreement between you and Ballylife regarding your subscription -- nothing outside this document is binding unless we say so in writing.</p>
      <p class="callout">We're not liable for any direct, indirect, incidental, or consequential loss arising from your use of, or inability to use, a subscription benefit, except where the law says otherwise. You agree to cover us for any loss or claim arising from your use of the subscription.</p>
    </section>

  </main>
</div>

<footer>
  <div class="footer-inner">
    <div>
      <h3>Questions about your subscription?</h3>
      <p>Our support team can help with billing, benefits, or cancelling.</p>
    </div>
    <a class="help-link" href="#">Visit the Help Centre</a>
  </div>
</footer>

</body>
</html>`;

export function BallylifeMorePage({ onBack }: { onBack: () => void }) {
  return <PolicyPageFrame title="Ballylife BallylifeMORE Subscription Terms" srcDoc={BALLYLIFEMORE_PAGE_HTML} onBack={onBack} />;
}
