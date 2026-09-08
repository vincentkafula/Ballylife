import { PolicyPageFrame } from "./PolicyPageFrame";

// Has its own scroll-spy <script> (highlights the active section in both
// the sidebar rail and top nav as the reader scrolls) -- rendered via an
// iframe's srcDoc for the same reason as the other standalone pages:
// dangerouslySetInnerHTML never executes injected <script> tags, and the
// iframe keeps this page's bespoke typography/color system isolated
// from the rest of the app.
const CREDIT_REWARDS_PAGE_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Ballylife.credit Rewards Programme Terms - Ballylife</title>
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
  .topbar nav{ display: flex; gap: 18px; font-size: 13.5px; overflow-x: auto; }
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
  @media (max-width: 940px){ .topbar nav{ display: none; } }

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

  .checklist{ margin-top: 22px; }
  .check{
    display: grid; grid-template-columns: 24px 1fr; gap: 12px;
    padding: 12px 0; border-top: 1px solid var(--line); font-size: 15.5px;
  }
  .check:last-child{ border-bottom: 1px solid var(--line); }
  .check .mark{ color: var(--gold); }

  .applies-box{
    margin-top: 22px; background: var(--paper-deep); border: 1px solid var(--paper-line);
    padding: 20px 24px; font-size: 15px;
  }
  .applies-box strong{ color: var(--pine); }

  .tagcloud{ display: flex; flex-wrap: wrap; gap: 9px; margin-top: 20px; }
  .tagcloud span{
    font-family: var(--mono); font-size: 12.5px; color: var(--pine-soft);
    border: 1px solid var(--paper-line); background: var(--paper-deep); padding: 7px 12px;
  }

  .worked{
    margin-top: 22px; border: 1px solid var(--paper-line); background: var(--paper-deep);
  }
  .worked .row{
    display: flex; justify-content: space-between; padding: 12px 20px;
    font-size: 15px; border-top: 1px solid var(--paper-line);
  }
  .worked .row:first-child{ border-top: none; }
  .worked .row.total{ font-family: 'Fraunces', serif; color: var(--pine); font-weight: 500; }
  .worked .row span:last-child{ font-family: var(--mono); }

  .sched{ margin-top: 22px; border-top: 1px solid var(--line); }
  .sched-row{
    display: grid; grid-template-columns: 100px 1fr 160px;
    gap: 16px; padding: 14px 0; border-bottom: 1px solid var(--line); align-items: center;
  }
  .sched-row.head{ font-family: var(--mono); font-size: 11.5px; color: var(--pine-soft); letter-spacing: 0.02em; }
  .sched-row .q{ font-family: 'Fraunces', serif; color: var(--gold); font-style: italic; font-size: 16px; }
  .sched-row .win{ font-size: 14.5px; }
  .sched-row .paid{ font-family: var(--mono); font-size: 13.5px; color: var(--pine-soft); text-align: right; }
  @media (max-width: 640px){
    .sched-row{ grid-template-columns: 1fr; gap: 4px; }
    .sched-row .paid{ text-align: left; }
  }

  .rights-grid{ margin-top: 22px; display: grid; gap: 0; }
  .right-item{
    display: grid; grid-template-columns: 26px 1fr; gap: 12px;
    padding: 12px 0; border-top: 1px solid var(--line); font-size: 15.5px;
  }
  .right-item:last-child{ border-bottom: 1px solid var(--line); }
  .right-item .n{ font-family: var(--mono); color: var(--gold); font-size: 13px; }

  .quote-block{
    background: var(--paper-deep); border-left: 3px solid var(--gold);
    padding: 22px 26px; margin: 22px 0 4px;
    font-family: 'Fraunces', serif; font-size: 17.5px; color: var(--pine);
    font-style: italic; line-height: 1.5;
  }

  .note{ margin-top: 18px; font-size: 14px; color: var(--pine-soft); border-left: 2px solid var(--gold-soft); padding-left: 16px; }

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
      <div class="wordmark">Ballylife <small>/credit-rewards</small></div>
      <nav id="topnav">
        <a href="#eligibility">Eligibility</a>
        <a href="#earning">Earning</a>
        <a href="#exclusions">Exclusions</a>
        <a href="#payouts">Payouts</a>
        <a href="#redemption">Redemption</a>
        <a href="#rights">Our rights</a>
        <a href="#legal">Legal</a>
      </nav>
      <a class="contact-btn" href="#help">Help Centre</a>
    </div>
  </div>

  <header class="hero">
    <div class="hero-inner">
      <span class="kicker">Ballylife &middot; Credit Rewards</span>
      <h1>Ballylife.credit Rewards Programme Terms</h1>
      <p class="lede">Ballylife.credit is our way of giving something back when you use your Ballylife.credit account to shop with us. These terms explain exactly how that works -- what qualifies, how much you earn, and when it lands in your account.</p>
      <div class="hero-stats">
        <div class="hero-stat"><div class="num">%</div><div class="lbl">of eligible spend earned back as credit</div></div>
        <div class="hero-stat"><div class="num">4x</div><div class="lbl">yearly payouts, one per quarter</div></div>
        <div class="hero-stat"><div class="num">3yr</div><div class="lbl">window to redeem before credit expires</div></div>
        <div class="hero-stat"><div class="num">30d</div><div class="lbl">wait after delivery before rewards accrue</div></div>
      </div>
    </div>
  </header>

  <div class="body-grid">
    <aside class="rail">
      <div class="rail-title">On this page</div>
      <a href="#intro">Introduction</a>
      <a href="#eligibility">Eligibility</a>
      <a href="#earning">How rewards are earned</a>
      <a href="#exclusions">What doesn't count</a>
      <a href="#payouts">Payout schedule</a>
      <a href="#redemption">Redeeming your credit</a>
      <a href="#rights">Our rights</a>
      <a href="#legal">Legal odds &amp; ends</a>
    </aside>

    <main class="content">

      <section id="intro">
        <span class="eyebrow">Introduction</span>
        <h2><span class="clause-num">01</span>Welcome to Ballylife.credit Rewards</h2>
        <p class="lead-para">This programme rewards customers for paying with their Ballylife.credit account on Ballylife.com. Taking part means agreeing to the terms below, so it's worth reading through before you start earning.</p>
        <p>The programme is run by Ballylife. Where we say "we," "us," or "Ballylife" in these terms, that's who we mean.</p>
      </section>

      <section id="eligibility">
        <span class="eyebrow">Eligibility</span>
        <h2><span class="clause-num">02</span>What you need to take part</h2>
        <p class="lead-para">Three things need to be true for you to earn rewards through this programme.</p>
        <div class="checklist">
          <div class="check"><span class="mark">-</span><span>You hold an active Ballylife.credit account -- an online credit facility provided and administered by a third-party credit provider on Ballylife's behalf.</span></div>
          <div class="check"><span class="mark">-</span><span>You have a registered customer account on Ballylife.com.</span></div>
          <div class="check"><span class="mark">-</span><span>You pay for a purchase on Ballylife.com using your Ballylife.credit account.</span></div>
        </div>
        <div class="applies-box"><strong>Note.</strong> Full details of the credit facility itself -- including its provider, fees, and lending terms -- are set out separately in your Ballylife.credit account agreement, not in this programme's terms.</div>
      </section>

      <section id="earning">
        <span class="eyebrow">How it works</span>
        <h2><span class="clause-num">03</span>How rewards are earned and valued</h2>
        <p class="lead-para">Rewards only apply to the portion of a purchase actually paid for with your Ballylife.credit account -- we call this your "eligible purchase."</p>
        <p>We set the reward percentage, calculated against the total order value including VAT, and we may change that percentage, the eligibility criteria, or the exclusions below at any time. Any change only applies going forward -- rewards you've already earned are never affected.</p>
        <p>Rewards are calculated once two conditions are met: the exclusions below have been applied, and 30 days have passed since your order was delivered or collected.</p>
      </section>

      <section id="exclusions">
        <span class="eyebrow">What doesn't count</span>
        <h2><span class="clause-num">04</span>Exclusions from the rewards calculation</h2>
        <p class="lead-para">Some purchases can't earn rewards at all, and some amounts are simply left out of the calculation.</p>
        <p>Products we're legally restricted from rewarding purchases on are excluded entirely. That currently includes:</p>
        <div class="tagcloud">
          <span>Alcohol</span>
          <span>Pharmaceuticals</span>
          <span>Infant formula</span>
          <span>Follow-up formula</span>
          <span>Special dietary / medical formula</span>
          <span>Feeding bottles, teats &amp; spouted cups</span>
        </div>
        <p>On top of that, the value of anything you return, and any gift vouchers used, is subtracted before we calculate your reward.</p>
        <div class="worked">
          <div class="row"><span>Order total (incl. VAT)</span><span>R1,000</span></div>
          <div class="row"><span>Less: returned items</span><span>-R400</span></div>
          <div class="row total"><span>Rewarded on</span><span>R600</span></div>
        </div>
      </section>

      <section id="payouts">
        <span class="eyebrow">When you get paid</span>
        <h2><span class="clause-num">05</span>Payout schedule</h2>
        <p class="lead-para">Earned rewards aren't credited immediately -- they're totalled up and paid out once a quarter, straight into your Ballylife customer account.</p>
        <div class="sched">
          <div class="sched-row head"><span>Quarter</span><span>Covers</span><span>Paid on</span></div>
          <div class="sched-row"><span class="q">Q1</span><span class="win">January - March</span><span class="paid">Last day of May</span></div>
          <div class="sched-row"><span class="q">Q2</span><span class="win">April - June</span><span class="paid">Last day of August</span></div>
          <div class="sched-row"><span class="q">Q3</span><span class="win">July - September</span><span class="paid">Last day of November</span></div>
          <div class="sched-row"><span class="q">Q4</span><span class="win">October - December</span><span class="paid">Last day of February</span></div>
        </div>
        <p class="note">If a payout date falls on a weekend or public holiday, it's paid on the next business day instead.</p>
      </section>

      <section id="redemption">
        <span class="eyebrow">Using what you've earned</span>
        <h2><span class="clause-num">06</span>Redeeming your credit</h2>
        <p class="lead-para">Once credited to your account, rewards can be put toward future purchases on Ballylife.com.</p>
        <div class="quote-block">
          Credit must be used within three years of being issued, or it expires. It can't be cashed out, transferred to anyone else, or used to offset money you owe us.
        </div>
        <p>If we process any personal information as part of your participation in this programme, we handle it in line with applicable data protection law and our Privacy Policy.</p>
      </section>

      <section id="rights">
        <span class="eyebrow">What we can do</span>
        <h2><span class="clause-num">07</span>Our rights over the programme</h2>
        <p class="lead-para">We've built this programme to run indefinitely, but we need room to adjust or wind it down responsibly. At our discretion, and on notice to you, we may:</p>
        <div class="rights-grid">
          <div class="right-item"><span class="n">a</span><span>Approve or decline your participation in the programme.</span></div>
          <div class="right-item"><span class="n">b</span><span>Suspend or end your participation, temporarily or permanently.</span></div>
          <div class="right-item"><span class="n">c</span><span>Amend these terms.</span></div>
          <div class="right-item"><span class="n">d</span><span>End the programme altogether.</span></div>
        </div>
        <p>Any of the above takes effect once published on Ballylife.com -- it's on you to check back periodically, and continuing to use the programme after a change means you've accepted it. None of this touches rewards you've already earned; those stand regardless of what happens to the programme afterward.</p>
      </section>

      <section id="legal">
        <span class="eyebrow">The fine print</span>
        <h2><span class="clause-num">08</span>Legal odds and ends</h2>
        <p class="lead-para">A few standard provisions that apply to this programme like any other agreement.</p>
        <p>If we don't enforce a right under these terms on one occasion, that's not us giving it up for good. If any individual clause turns out to be invalid or unenforceable, the rest of these terms remain in force.</p>
        <p>We're not liable for direct or indirect loss arising from your participation in the programme or your use of any credit it issues. These terms are governed by the laws of the Republic of South Africa.</p>
        <div class="report-box">
          <h3 id="help">Questions about the programme?</h3>
          <p>Our Help Centre is the fastest way to get an answer about your rewards, your account, or these terms.</p>
          <a class="addr" href="#">Visit the Ballylife Help Centre</a>
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

export function CreditRewardsPage({ onBack }: { onBack: () => void }) {
  return <PolicyPageFrame title="Ballylife.credit Rewards Programme Terms" srcDoc={CREDIT_REWARDS_PAGE_HTML} onBack={onBack} />;
}
