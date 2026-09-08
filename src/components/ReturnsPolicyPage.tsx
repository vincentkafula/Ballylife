import { useRef } from "react";

// Has its own scroll-spy <script> (highlights the active section in both
// the sidebar rail and top nav as the reader scrolls) -- rendered via an
// iframe's srcDoc for the same reason as the other standalone pages:
// dangerouslySetInnerHTML never executes injected <script> tags, and the
// iframe keeps this page's bespoke typography/color system isolated
// from the rest of the app.
const RETURNS_PAGE_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Returns Policy - Ballylife</title>
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
  @media (max-width: 1100px){ .topbar nav{ display: none; } }

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
    display: grid; grid-template-columns: 230px 1fr; gap: 56px; align-items: start;
  }
  .rail{ position: sticky; top: 74px; padding-top: 64px; font-size: 13px; max-height: calc(100vh - 90px); overflow-y: auto; }
  .rail-title{ font-family: var(--mono); color: var(--gold); font-size: 12px; margin-bottom: 14px; letter-spacing: 0.02em; }
  .rail a{
    display: block; padding: 5.5px 0; color: var(--pine-soft); text-decoration: none;
    border-left: 2px solid transparent; padding-left: 12px; margin-left: -13px;
    transition: color .15s ease, border-color .15s ease;
  }
  .rail a:hover, .rail a.active{ color: var(--pine); border-color: var(--gold); }
  @media (max-width: 980px){ .body-grid{ grid-template-columns: 1fr; } .rail{ display: none; } }

  .content{ min-width: 0; }
  section{ padding: 52px 0; border-bottom: 1px solid var(--line); max-width: var(--content-max); }
  section:first-of-type{ padding-top: 66px; }
  section:last-of-type{ border-bottom: none; }

  .eyebrow{ font-family: var(--mono); color: var(--gold); font-size: 13px; margin-bottom: 12px; display: block; letter-spacing: 0.02em; }
  h2{ font-size: clamp(21px, 3vw, 27px); max-width: 26ch; }
  .lead-para{ font-size: 17.5px; color: var(--pine-soft); max-width: 58ch; margin-top: 14px; }
  p{ margin: 14px 0; max-width: 62ch; }
  h4{ font-size: 16px; margin: 20px 0 8px; }

  ul.plain{ margin: 12px 0; padding-left: 20px; }
  ul.plain li{ margin: 6px 0; font-size: 15.5px; }

  .checklist{ margin-top: 22px; }
  .check{
    display: grid; grid-template-columns: 24px 1fr; gap: 12px;
    padding: 11px 0; border-top: 1px solid var(--line); font-size: 15.5px;
  }
  .check:last-child{ border-bottom: 1px solid var(--line); }
  .check .mark{ color: var(--gold); }

  .time-cols{ display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 24px; }
  .time-card{ background: var(--paper-deep); border: 1px solid var(--paper-line); padding: 22px 24px; }
  .time-card .days{ font-family: 'Fraunces', serif; font-size: 30px; color: var(--gold); }
  .time-card .lbl{ font-size: 14.5px; color: var(--pine-soft); margin-top: 4px; }
  .time-card .desc{ font-size: 14px; margin-top: 10px; }
  @media (max-width: 640px){ .time-cols{ grid-template-columns: 1fr; } }

  .tagcloud{ display: flex; flex-wrap: wrap; gap: 9px; margin-top: 18px; }
  .tagcloud span{
    font-family: var(--mono); font-size: 12.5px; color: var(--pine-soft);
    border: 1px solid var(--paper-line); background: var(--paper-deep); padding: 7px 12px;
  }

  .quote-block{
    background: var(--paper-deep); border-left: 3px solid var(--gold);
    padding: 22px 26px; margin: 22px 0 4px;
    font-family: 'Fraunces', serif; font-size: 17.5px; color: var(--pine);
    font-style: italic; line-height: 1.5;
  }

  .note{ margin-top: 18px; font-size: 14px; color: var(--pine-soft); border-left: 2px solid var(--gold-soft); padding-left: 16px; }

  .excl-cols{ display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 22px; }
  .excl-col h4{ font-size: 14.5px; margin: 0 0 10px; display: flex; align-items: center; gap: 8px; }
  .dot{ width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
  .dot.ok{ background: var(--ok); }
  .dot.no{ background: var(--no); }
  .excl-col ul{ list-style: none; margin: 0; padding: 0; }
  .excl-col li{ font-size: 14.5px; padding: 9px 0; border-top: 1px solid var(--line); }
  .excl-col li:last-child{ border-bottom: 1px solid var(--line); }
  @media (max-width: 640px){ .excl-cols{ grid-template-columns: 1fr; } }

  .warranty-cards{ margin-top: 22px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .warranty-card{ border: 1px solid var(--paper-line); padding: 20px 22px; }
  .warranty-card h4{ margin-top: 0; font-size: 16.5px; }
  .warranty-card p{ font-size: 14.5px; margin: 8px 0 0; }
  @media (max-width: 640px){ .warranty-cards{ grid-template-columns: 1fr; } }

  .steps{ margin-top: 18px; }
  .step{
    display: grid; grid-template-columns: 26px 1fr; gap: 12px;
    padding: 10px 0; border-top: 1px solid var(--line); font-size: 14.5px;
  }
  .step:last-child{ border-bottom: 1px solid var(--line); }
  .step .n{ font-family: var(--mono); color: var(--gold); font-size: 12px; }

  .item-grid{ margin-top: 24px; display: grid; gap: 0; }
  .item-row{
    padding: 18px 0; border-top: 1px solid var(--line);
  }
  .item-row:last-child{ border-bottom: 1px solid var(--line); }
  .item-row h4{ margin: 0 0 6px; font-size: 16px; }
  .item-row p{ margin: 0; font-size: 14.5px; }

  .nr-cat{ margin-top: 22px; }
  .nr-cat h4{ font-size: 15px; margin-bottom: 8px; }
  .nr-cat ul{ list-style: none; margin: 0 0 18px; padding: 0; }
  .nr-cat li{ font-size: 14.5px; padding: 8px 0; border-top: 1px solid var(--line); }
  .nr-cat li:last-child{ border-bottom: 1px solid var(--line); }

  .worked{
    margin-top: 18px; border: 1px solid var(--paper-line); background: var(--paper-deep);
  }
  .worked .row{
    display: flex; justify-content: space-between; padding: 11px 18px;
    font-size: 14.5px; border-top: 1px solid var(--paper-line);
  }
  .worked .row:first-child{ border-top: none; }
  .worked .row.total{ font-family: 'Fraunces', serif; color: var(--pine); font-weight: 500; }
  .worked .row span:last-child{ font-family: var(--mono); }

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
      <div class="wordmark">Ballylife <small>/returns</small></div>
      <nav id="topnav">
        <a href="#time-limits">Time limits</a>
        <a href="#defective">Defective</a>
        <a href="#warranties">Warranties</a>
        <a href="#special-items">Special items</a>
        <a href="#non-returnable">Non-returnable</a>
        <a href="#refunds">Refunds</a>
      </nav>
      <a class="contact-btn" href="#help">Start a return</a>
    </div>
  </div>

  <header class="hero">
    <div class="hero-inner">
      <span class="kicker">Ballylife &middot; Returns</span>
      <h1>Returns Policy</h1>
      <p class="lede">We want you to be happy with what you buy from us. If something's wrong, you can send it back for an exchange, a replacement, or credit to your Ballylife account -- and returns are free.</p>
      <div class="hero-stats">
        <div class="hero-stat"><div class="num">Free</div><div class="lbl">returns, always</div></div>
        <div class="hero-stat"><div class="num">30d</div><div class="lbl">to return wrong, damaged, or unwanted items</div></div>
        <div class="hero-stat"><div class="num">6mo</div><div class="lbl">to return a defective item</div></div>
        <div class="hero-stat"><div class="num">3yr</div><div class="lbl">to use credit issued from a return</div></div>
      </div>
    </div>
  </header>

  <div class="body-grid">
    <aside class="rail">
      <div class="rail-title">Table of contents</div>
      <a href="#time-limits">Time limits</a>
      <a href="#prepare">Preparing your return</a>
      <a href="#wrong-damaged">Wrong, damaged, or missing parts</a>
      <a href="#changed-mind">Changed your mind</a>
      <a href="#defective">Defective items</a>
      <a href="#warranties">Warranty items</a>
      <a href="#special-items">Bundles, digital &amp; data-storing items</a>
      <a href="#wrong-returned">Wrong item returned</a>
      <a href="#taking-back">Taking back a rejected item</a>
      <a href="#collection">Collection</a>
      <a href="#non-returnable">Non-returnable items</a>
      <a href="#exchanges">Exchanges</a>
      <a href="#refunds">Credit and refunds</a>
      <a href="#vouchers">Paid with a coupon or voucher</a>
    </aside>

    <main class="content">

      <section id="intro">
        <span class="eyebrow">Before you start</span>
        <h2>What makes a return hassle-free</h2>
        <p class="lead-para">Most returns go smoothly when a few simple things are true about the item you're sending back.</p>
        <div class="checklist">
          <div class="check"><span class="mark">-</span><span>It's in its original packaging and hasn't been used.</span></div>
          <div class="check"><span class="mark">-</span><span>Tags are still attached and it hasn't been worn -- trying something on is fine, wearing it isn't.</span></div>
          <div class="check"><span class="mark">-</span><span>Every part and accessory that came with it is included.</span></div>
          <div class="check"><span class="mark">-</span><span>You're within the relevant time limit.</span></div>
          <div class="check"><span class="mark">-</span><span>It isn't on our non-returnable list.</span></div>
        </div>
      </section>

      <section id="time-limits">
        <span class="eyebrow">Deadlines</span>
        <h2>Time limits</h2>
        <p class="lead-para">How long you have to return something depends on why you're returning it.</p>
        <div class="time-cols">
          <div class="time-card">
            <div class="days">30 days</div>
            <div class="lbl">from delivery</div>
            <div class="desc">Covers wrong items, items damaged on delivery, missing parts, and simple changes of mind.</div>
          </div>
          <div class="time-card">
            <div class="days">6 months</div>
            <div class="lbl">from delivery</div>
            <div class="desc">Covers items that turn out to be defective.</div>
          </div>
        </div>
      </section>

      <section id="prepare">
        <span class="eyebrow">Packing it up</span>
        <h2>Preparing your return</h2>
        <p class="lead-para">Pack the item carefully so it isn't damaged in transit, and send it back in its original packaging with every accessory, part, and seal intact.</p>
        <p>If something's missing, we won't be able to accept the return and will send the item back to you. You're welcome to log the return again once you have everything together -- though we may charge a collection fee, and a delivery fee if we're sending a replacement back to you.</p>
      </section>

      <section id="wrong-damaged">
        <span class="eyebrow">Not your fault</span>
        <h2>Wrong item, damaged on delivery, or missing parts</h2>
        <p class="lead-para">If we got something wrong on our end, you have 30 days from delivery to let us know, and it's your call how we make it right: replacement, account credit, or a refund. If we don't have replacement stock, we'll default to crediting your account instead.</p>
        <p>An item generally isn't treated as "damaged on delivery" if it was damaged after it reached you, if the damage came from an electrical surge, or if it's simply being used for something it wasn't designed for.</p>
      </section>

      <section id="changed-mind">
        <span class="eyebrow">No hard feelings</span>
        <h2>You changed your mind</h2>
        <p class="lead-para">Sometimes an item just isn't right after all -- that's fine. You have 30 days from delivery to send it back, as long as it still meets the return conditions above.</p>
      </section>

      <section id="defective">
        <span class="eyebrow">When something breaks</span>
        <h2>Defective items</h2>
        <p class="lead-para">Defective items can be returned within 6 months of delivery. Once we receive it, we'll inspect it, and if we accept the return, you choose between a repair, a replacement, account credit, or a refund -- though not every defect can be repaired, and replacement stock isn't always available.</p>
        <p>A return generally won't be accepted as "defective" if the fault is down to normal wear and tear, if the item wasn't looked after properly, if it was damaged by an electrical surge or corrosion, if it's been modified, or if it's simply being used outside its intended purpose.</p>
      </section>

      <section id="warranties">
        <span class="eyebrow">Beyond six months</span>
        <h2>Warranty items</h2>
        <p class="lead-para">Some products carry a warranty that runs longer than our standard 6-month defect window -- check the product page for details, along with the specific terms that warranty carries.</p>
        <div class="warranty-cards">
          <div class="warranty-card">
            <h4>Extended warranties</h4>
            <p>If an item becomes defective after the 6-month mark but is still within its extended warranty, log the return with us as soon as you notice. We'll help get it to the supplier at no cost to you. The supplier inspects it and decides whether to accept the return -- they may charge an evaluation fee. If they accept it and repair or replacement takes longer than 21 days from when they receive it, we'll step in with credit or a refund directly.</p>
          </div>
          <div class="warranty-card">
            <h4>Manufacturer (direct) warranties</h4>
            <p>Some items are covered directly by the manufacturer instead. When you log a return on one of these, we'll give you the manufacturer's contact details so you can deal with them directly.</p>
          </div>
        </div>
      </section>

      <section id="special-items">
        <span class="eyebrow">It depends what you bought</span>
        <h2>Bundles, digital items, and items that store data</h2>
        <p class="lead-para">A few product types follow their own return logic.</p>
        <div class="item-grid">
          <div class="item-row">
            <h4>Bundle deals</h4>
            <p>Where we or you assembled a bundle from separate items, you can return the whole bundle or just one item from it, and we'll credit you for what you paid after any bundle discount.</p>
          </div>
          <div class="item-row">
            <h4>Pre-packed bundles</h4>
            <p>Where a supplier packaged the bundle as a single unit, we generally need every item in it back together -- sending only part of it back may mean we can't accept the return.</p>
          </div>
          <div class="item-row">
            <h4>Digital items</h4>
            <p>Vouchers, game codes, course codes, and other digital downloads can only be returned if they're defective -- for example, a code that doesn't work. Tell us within 6 months of delivery, and we'll look into it before offering a replacement or refund.</p>
          </div>
          <div class="item-row">
            <h4>Items that store data</h4>
            <p>If a device stores data, we'll need your unlock code or password to assess it -- without that access, we can't process the return. Assessing it may require a factory reset, so back up anything you want to keep before sending it in.</p>
          </div>
          <div class="item-row">
            <h4>Vehicles</h4>
            <p>Vehicles follow their own compliance and delivery process rather than this general policy -- see the Platform Terms for details. Once a vehicle has been delivered, it isn't returnable under this policy.</p>
          </div>
        </div>
      </section>

      <section id="wrong-returned">
        <span class="eyebrow">If a mix-up happens</span>
        <h2>Sent us the wrong item?</h2>
        <p class="lead-para">If you accidentally sent back something other than what you meant to return, contact us right away. Items returned in error are disposed of after a period, so we can't guarantee we'll still have it, and we won't be able to compensate you if it's gone. If we do still have it, you'll need to arrange to collect it.</p>
      </section>

      <section id="taking-back">
        <span class="eyebrow">If we can't accept it</span>
        <h2>Taking back a rejected return</h2>
        <p class="lead-para">If we reject your return, we'll send the item back to you. If we can't get it to you within 30 days of the rejection -- say, because you're unreachable or decline delivery -- we'll treat it as abandoned and may dispose of it.</p>
      </section>

      <section id="collection">
        <span class="eyebrow">Getting it back to us</span>
        <h2>Collection</h2>
        <p class="lead-para">When you log a return, we'll arrange to collect the item from your delivery address. This applies to every item, including large items and alcohol.</p>
      </section>

      <section id="non-returnable">
        <span class="eyebrow">The exceptions</span>
        <h2>Non-returnable items</h2>
        <p class="lead-para">Some products are marked non-returnable on their product page -- though even those can usually still be returned if we sent the wrong thing, or it arrived damaged or defective. If you're not sure, just ask us.</p>
        <div class="nr-cat">
          <h4>Health and safety</h4>
          <ul>
            <li>Intimate apparel, underwear, swimwear, and jewellery</li>
            <li>Food, beverages, and other everyday consumables</li>
          </ul>
          <h4>Once opened, it's yours</h4>
          <ul>
            <li>Digital items -- vouchers, game codes, downloads</li>
            <li>Unsealed audio, video, or software</li>
            <li>Books and periodicals</li>
          </ul>
          <h4>Made just for you</h4>
          <ul>
            <li>Anything personalised or custom-made to your specifications</li>
          </ul>
        </div>
      </section>

      <section id="exchanges">
        <span class="eyebrow">Wrong size, wrong colour</span>
        <h2>Exchanges</h2>
        <p class="lead-para">Clothing, sportswear, and shoes can be exchanged for a different size or colour, rather than going through a full return and re-purchase.</p>
      </section>

      <section id="refunds">
        <span class="eyebrow">Getting your money back</span>
        <h2>Credit and refunds</h2>
        <p class="lead-para">When you log your return, choose whichever outcome suits you: account credit, a refund, or a replacement.</p>
        <div class="quote-block">
          Credit lands in your account within 2 business days of your return being accepted, and you have 3 years to use it before it expires.
        </div>
        <p>If you'd rather have a refund, it goes back the way you paid, and typically takes 3 to 5 business days to reflect -- subject to your bank or payment provider's own timing. If your original payment method is no longer available, we'll ask for your bank details and verify them first, which can take a little longer. If your purchase included a donation, that amount is subtracted from whatever we refund or credit you.</p>
      </section>

      <section id="vouchers">
        <span class="eyebrow">If a voucher was involved</span>
        <h2>Paid with a coupon or voucher</h2>
        <p class="lead-para">Vouchers and coupons are treated a little differently when part of an order comes back.</p>
        <h4>Vouchers</h4>
        <p>The value of the voucher you used is loaded back as non-refundable credit -- the rest of what you paid can be credited or refunded, your choice.</p>
        <div class="worked">
          <div class="row"><span>Item price</span><span>R500</span></div>
          <div class="row"><span>Paid with voucher</span><span>R100 -&gt; returned as credit</span></div>
          <div class="row total"><span>Remaining, your choice</span><span>R400</span></div>
        </div>
        <h4>Coupons</h4>
        <p>We issue a new coupon for the value you originally spent using it, under its own terms -- which may differ from the original coupon's terms. If a coupon was split across several items and you only return one, the new coupon reflects just that item's share of the discount.</p>
        <p class="note">Have a return that doesn't fit neatly into any of the above? Reach out and we'll help you figure it out.</p>
        <div class="report-box">
          <h3 id="help">Ready to start a return?</h3>
          <p>Head to your orders in your Ballylife account, or get in touch if you have questions first.</p>
          <a class="addr" href="#">Visit the Ballylife Help Centre</a>
        </div>
      </section>

    </main>
  </div>

  <div class="page">
    <footer>
      <div class="brand">Ballylife</div>
      <p>We may update this Returns Policy from time to time. The version published here is the one that applies.</p>
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

export function ReturnsPolicyPage({ onBack }: { onBack: () => void }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-2.5 border-b border-gray-100 bg-white shrink-0">
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-800">&larr; Back to shopping</button>
      </div>
      <iframe
        ref={iframeRef}
        title="Ballylife Returns Policy"
        srcDoc={RETURNS_PAGE_HTML}
        className="flex-1 w-full border-0"
        style={{ minHeight: 0 }}
      />
    </div>
  );
}
