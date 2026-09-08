import { useRef } from "react";

// Has its own scroll-spy <script> (highlights the active section in both
// the sidebar rail and top nav as the reader scrolls) -- rendered via an
// iframe's srcDoc for the same reason as the other standalone pages:
// dangerouslySetInnerHTML never executes injected <script> tags, and the
// iframe keeps this page's bespoke typography/color system isolated
// from the rest of the app.
const ADVERTISING_PAGE_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Code of Advertising Practice - Ballylife</title>
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
    --rust: #A0432E;
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
  .topbar nav{ display: flex; gap: 20px; font-size: 13.5px; overflow-x: auto; }
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
  @media (max-width: 900px){ .topbar nav{ display: none; } }

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
  .hero-marks{ position: absolute; right: 0; top: 0; width: 300px; height: 300px; opacity: 0.5; pointer-events: none; }
  .hero-marks circle{ fill: none; stroke: rgba(246,243,234,0.16); }
  .kicker{ font-family: var(--mono); font-size: 13px; letter-spacing: 0.03em; color: var(--gold-soft); margin-bottom: 20px; display: block; }
  .hero h1{ color: var(--paper); font-size: clamp(32px, 4.8vw, 50px); line-height: 1.12; max-width: 16ch; }
  .hero p.lede{ margin: 24px 0 0; max-width: 60ch; font-size: 18px; color: #D8E0D2; }

  .hero-pillars{
    margin-top: 44px; display: grid; grid-template-columns: repeat(5, 1fr);
    border-top: 1px solid rgba(246,243,234,0.18);
  }
  .hero-pillar{ padding: 20px 18px 26px 0; border-right: 1px solid rgba(246,243,234,0.18); }
  .hero-pillar:last-child{ border-right: none; padding-right: 0; }
  .hero-pillar .word{ font-family: 'Fraunces', serif; font-size: 18px; color: var(--gold-soft); font-style: italic; }
  .hero-pillar .sub{ font-size: 12.5px; color: #C9D3C2; margin-top: 6px; }
  @media (max-width: 820px){
    .hero-inner{ padding: 60px 24px 0; }
    .hero-pillars{ grid-template-columns: 1fr 1fr; }
    .hero-pillar{ border-right: none; border-bottom: 1px solid rgba(246,243,234,0.18); padding: 16px 0; }
  }

  .body-grid{
    max-width: var(--page-max); margin: 0 auto; padding: 0 32px;
    display: grid; grid-template-columns: 210px 1fr; gap: 56px; align-items: start;
  }
  .rail{ position: sticky; top: 74px; padding-top: 64px; font-size: 14px; }
  .rail-title{ font-family: var(--mono); color: var(--gold); font-size: 12px; margin-bottom: 14px; letter-spacing: 0.02em; }
  .rail a{
    display: block; padding: 7px 0; color: var(--pine-soft); text-decoration: none;
    border-left: 2px solid transparent; padding-left: 12px; margin-left: -13px;
    transition: color .15s ease, border-color .15s ease;
  }
  .rail a:hover, .rail a.active{ color: var(--pine); border-color: var(--gold); }
  @media (max-width: 980px){ .body-grid{ grid-template-columns: 1fr; } .rail{ display: none; } }

  .content{ min-width: 0; }
  section{ padding: 58px 0; border-bottom: 1px solid var(--line); max-width: var(--content-max); }
  section:first-of-type{ padding-top: 68px; }
  section:last-of-type{ border-bottom: none; }

  .eyebrow{ font-family: var(--mono); color: var(--gold); font-size: 13px; margin-bottom: 12px; display: block; letter-spacing: 0.02em; }
  h2{ font-size: clamp(22px, 3vw, 28px); max-width: 22ch; }
  .lead-para{ font-size: 18px; color: var(--pine-soft); max-width: 58ch; margin-top: 16px; }
  p{ margin: 15px 0; max-width: 62ch; }

  .def-list{ margin-top: 26px; display: grid; gap: 0; }
  .def{
    padding: 18px 0; border-top: 1px solid var(--line);
    display: grid; grid-template-columns: 170px 1fr; gap: 20px;
  }
  .def:last-child{ border-bottom: 1px solid var(--line); }
  .def dt{ font-family: 'Fraunces', serif; font-style: italic; color: var(--pine); font-size: 16px; }
  .def dd{ margin: 0; font-size: 15.5px; }
  @media (max-width: 640px){ .def{ grid-template-columns: 1fr; gap: 6px; } }

  .applies-box{
    margin-top: 26px; background: var(--paper-deep); border: 1px solid var(--paper-line);
    padding: 22px 26px; font-size: 15.5px;
  }
  .applies-box strong{ color: var(--pine); }
  .applies-tags{ display: flex; flex-wrap: wrap; gap: 9px; margin-top: 14px; }
  .applies-tags span{
    font-family: var(--mono); font-size: 12.5px; color: var(--pine);
    border: 1px solid var(--pine); padding: 6px 12px; border-radius: 999px;
  }

  .commit-head{
    display: flex; align-items: center; gap: 12px; margin-bottom: 4px;
  }
  .commit-num{
    font-family: var(--mono); color: var(--gold); font-size: 13px;
    border: 1px solid var(--gold); width: 26px; height: 26px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center; flex: none;
  }

  .example-cols{ display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 24px; }
  .example-col h4{ font-size: 14px; display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
  .dot{ width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
  .dot.ok{ background: var(--ok); }
  .dot.no{ background: var(--no); }
  .example-col ul{ list-style: none; margin: 0; padding: 0; }
  .example-col li{ font-size: 14.5px; padding: 9px 0; border-top: 1px solid var(--line); }
  .example-col li:last-child{ border-bottom: 1px solid var(--line); }
  @media (max-width: 640px){ .example-cols{ grid-template-columns: 1fr; } }

  .quote-block{
    background: var(--paper-deep); border-left: 3px solid var(--gold);
    padding: 24px 28px; margin: 26px 0 4px;
    font-family: 'Fraunces', serif; font-size: 18.5px; color: var(--pine);
    font-style: italic; line-height: 1.5;
  }

  .sponsor-demo{
    margin-top: 26px; border: 1px solid var(--paper-line); background: var(--paper-deep);
    padding: 18px 20px;
  }
  .sponsor-demo .row{ display: flex; align-items: center; gap: 12px; padding: 10px 0; }
  .sponsor-demo .row + .row{ border-top: 1px solid var(--paper-line); }
  .sponsor-demo .badge{
    font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.03em;
    color: var(--paper); background: var(--gold); padding: 3px 8px; border-radius: 3px; flex: none;
  }
  .sponsor-demo .txt{ font-size: 14.5px; color: var(--pine-soft); }

  .timeline{ margin-top: 32px; position: relative; padding-left: 28px; }
  .timeline::before{ content: ""; position: absolute; left: 5px; top: 6px; bottom: 6px; width: 1px; background: var(--paper-line); }
  .tl-item{ position: relative; padding-bottom: 28px; }
  .tl-item:last-child{ padding-bottom: 0; }
  .tl-item::before{
    content: ""; position: absolute; left: -28px; top: 4px; width: 11px; height: 11px;
    border-radius: 50%; background: var(--paper); border: 2px solid var(--gold);
  }
  .tl-item h4{ font-size: 17px; margin-bottom: 5px; }
  .tl-item p{ font-size: 15.5px; margin: 0; }
  .tl-item .when{ font-family: var(--mono); font-size: 12px; color: var(--gold); display: block; margin-bottom: 6px; }

  .report-box{ margin-top: 26px; background: var(--pine); color: var(--paper); padding: 28px 30px; }
  .report-box h3{ color: var(--paper); font-size: 18px; margin-bottom: 10px; }
  .report-box p{ color: #D8E0D2; font-size: 15.5px; margin: 0 0 16px; max-width: 56ch; }
  .report-box .addr{
    font-family: var(--mono); font-size: 17px; color: var(--gold-soft);
    display: inline-block; border-bottom: 1px dashed rgba(220,196,146,0.5);
  }

  .note{ margin-top: 20px; font-size: 14.5px; color: var(--pine-soft); border-left: 2px solid var(--gold-soft); padding-left: 16px; }

  .page{ max-width: var(--page-max); margin: 0 auto; padding: 0 32px; }
  footer{ max-width: var(--content-max); padding: 46px 0 88px; color: var(--pine-soft); font-size: 14px; }
  footer .brand{ font-family: 'Fraunces', serif; color: var(--pine); font-size: 16px; margin-bottom: 6px; }
</style>
</head>
<body>

  <div class="topbar">
    <div class="topbar-inner">
      <div class="wordmark">Ballylife <small>/advertising</small></div>
      <nav id="topnav">
        <a href="#definitions">Definitions</a>
        <a href="#lawful">Lawful</a>
        <a href="#honest">Honest</a>
        <a href="#decent">Decent</a>
        <a href="#truthful">Truthful</a>
        <a href="#transparent">Transparent</a>
        <a href="#complaints">Complaints</a>
      </nav>
      <a class="contact-btn" href="mailto:advertisingcomplaints@ballylife.com">Report an ad</a>
    </div>
  </div>

  <header class="hero">
    <svg class="hero-marks" viewBox="0 0 300 300" aria-hidden="true">
      <circle cx="300" cy="0" r="160"/>
      <circle cx="300" cy="0" r="110"/>
    </svg>
    <div class="hero-inner">
      <span class="kicker">Ballylife &middot; Advertising Standards</span>
      <h1>Code of Advertising Practice</h1>
      <p class="lede">Ballylife is a platform many different people call home -- as customers, as sellers, and as partners. Every paid placement that appears on it, whatever its source, is expected to meet the same standard of honesty and respect.</p>
      <div class="hero-pillars">
        <div class="hero-pillar"><div class="word">Lawful</div><div class="sub">within every applicable regulation</div></div>
        <div class="hero-pillar"><div class="word">Honest</div><div class="sub">never exploits trust or inexperience</div></div>
        <div class="hero-pillar"><div class="word">Decent</div><div class="sub">free of hate, violence, and stereotyping</div></div>
        <div class="hero-pillar"><div class="word">Truthful</div><div class="sub">every claim can be backed up</div></div>
        <div class="hero-pillar"><div class="word">Transparent</div><div class="sub">paid placements are always labelled</div></div>
      </div>
    </div>
  </header>

  <div class="body-grid">
    <aside class="rail">
      <div class="rail-title">On this page</div>
      <a href="#intro">Introduction</a>
      <a href="#definitions">Definitions</a>
      <a href="#lawful">Lawful advertising</a>
      <a href="#honest">Honest advertising</a>
      <a href="#decent">Decent advertising</a>
      <a href="#truthful">Truthful advertising</a>
      <a href="#transparent">Transparent advertising</a>
      <a href="#complaints">Raising a concern</a>
    </aside>

    <main class="content">

      <section id="intro">
        <span class="eyebrow">Introduction</span>
        <h2>A platform built on trust, kept that way by design</h2>
        <p class="lead-para">Ballylife aims to reflect the full range of the people who use it -- in who appears in our advertising, and in the tone that advertising takes. Every image and message associated with Ballylife should feel consistent with that.</p>
        <p>This code sets the standard for every piece of commercial advertising that appears on Ballylife's website and apps. It exists so that our advertising stays lawful, honest, decent, truthful, and transparent -- and so that using Ballylife continues to feel safe, whoever you are.</p>
        <p>We update this code from time to time as our platform and the regulatory landscape evolve. The version published on this page is always the one that applies.</p>
      </section>

      <section id="definitions">
        <span class="eyebrow">Definitions</span>
        <h2>A couple of terms worth clarifying</h2>
        <p class="lead-para">Two terms come up throughout this code, so it's worth being precise about what each one means.</p>
        <dl class="def-list">
          <div class="def">
            <dt>Commercial advertising</dt>
            <dd>Any paid-for placement on the Ballylife website or apps -- display banners, pop-ups, and boosted listings that appear alongside organic search results, sometimes labelled as sponsored.</dd>
          </div>
          <div class="def">
            <dt>Advertiser</dt>
            <dd>Whoever the advertising is placed on behalf of. Depending on the placement, that might be Ballylife itself, a product supplier, or an independent seller trading on the platform.</dd>
          </div>
        </dl>
        <div class="applies-box">
          <strong>Who this code applies to.</strong> Everyone placing a paid advertisement on Ballylife is bound by it -- not only Ballylife's own marketing team.
          <div class="applies-tags">
            <span>Ballylife house ads</span>
            <span>Product suppliers</span>
            <span>Marketplace sellers</span>
            <span>Third-party ad partners</span>
          </div>
        </div>
      </section>

      <section id="lawful">
        <div class="commit-head"><span class="commit-num">1</span><h2>Commitment to lawful advertising</h2></div>
        <p class="lead-para">Every commercial advertisement on Ballylife must fully comply with the laws and regulations that apply to it -- this is the floor beneath everything else in this code, not an optional extra.</p>
        <p>Where a specific product category carries its own advertising rules -- financial products, health claims, or age-restricted goods, for example -- those rules apply in full, in addition to this code.</p>
      </section>

      <section id="honest">
        <div class="commit-head"><span class="commit-num">2</span><h2>Commitment to honest advertising</h2></div>
        <p class="lead-para">An advertisement should never be built to take advantage of a customer's trust, or to lean on their inexperience or credulity to make a sale.</p>
        <div class="example-cols">
          <div class="example-col">
            <h4><span class="dot ok"></span>Consistent with this code</h4>
            <ul>
              <li>Clear pricing with no hidden conditions</li>
              <li>Claims a typical customer would read the same way we intend</li>
              <li>Urgency that reflects a real, limited offer</li>
            </ul>
          </div>
          <div class="example-col">
            <h4><span class="dot no"></span>Not consistent with this code</h4>
            <ul>
              <li>Manufactured scarcity or fake countdowns</li>
              <li>Wording designed to be misread by a rushed reader</li>
              <li>Targeting a customer's known lack of expertise to mislead</li>
            </ul>
          </div>
        </div>
      </section>

      <section id="decent">
        <div class="commit-head"><span class="commit-num">3</span><h2>Commitment to decent advertising</h2></div>
        <p class="lead-para">Advertising on Ballylife should never make anyone feel demeaned, threatened, or excluded because of how it's written or what it shows.</p>
        <p>In context, that means no advertisement should contain foul language, obscenity, defamation, hate speech, or derogatory comments or imagery -- about anyone, whether they're a customer, a competitor, or a public figure.</p>
        <p>It also means advertising should never appear to support or glamorise violence or criminal activity, even indirectly, and should never lean on negative gender stereotypes or portray any gender in a demeaning way.</p>
        <div class="quote-block">
          If an advertisement wouldn't feel comfortable next to a photo of the people who'll actually see it, it doesn't belong on Ballylife.
        </div>
      </section>

      <section id="truthful">
        <div class="commit-head"><span class="commit-num">4</span><h2>Commitment to truthful advertising</h2></div>
        <p class="lead-para">Every claim in an advertisement -- stated outright or simply implied -- needs to be backed by real evidence before it's ever published, not found after the fact if someone asks.</p>
        <p>Advertisers are expected to hold onto that documentary evidence and be able to produce it if Ballylife or a regulator asks for it. A claim that can't be substantiated shouldn't be running in the first place.</p>
      </section>

      <section id="transparent">
        <div class="commit-head"><span class="commit-num">5</span><h2>Commitment to transparent advertising</h2></div>
        <p class="lead-para">When a customer searches on Ballylife, they should always be able to tell which results are organic and which are paid placements.</p>
        <div class="sponsor-demo">
          <div class="row"><span class="badge">SPONSORED</span><span class="txt">Boosted listing -- paid for by the advertiser, shown among search results</span></div>
          <div class="row"><span class="badge" style="background:var(--pine-soft);">ORGANIC</span><span class="txt">Ranked on relevance alone, with no payment involved</span></div>
        </div>
        <p>Any boosted product listing that appears alongside organic search results is labelled "sponsored," so customers always know when a result has been paid for rather than simply ranking on its own merits.</p>
      </section>

      <section id="complaints">
        <span class="eyebrow">If an ad falls short</span>
        <h2>Raising a concern about an advertisement</h2>
        <p class="lead-para">If you don't think Ballylife, or any advertiser using our platform, is meeting these commitments, we want to know about it.</p>
        <div class="report-box">
          <h3>Send us the details</h3>
          <p>Include a link or screenshot of the advertisement, where and when you saw it, and why you believe it falls short of this code.</p>
          <a class="addr" href="mailto:advertisingcomplaints@ballylife.com">advertisingcomplaints@ballylife.com</a>
        </div>
        <div class="timeline">
          <div class="tl-item">
            <span class="when">Step 1</span>
            <h4>We review</h4>
            <p>Your report is assessed against this code and, where relevant, applicable law.</p>
          </div>
          <div class="tl-item">
            <span class="when">Step 2</span>
            <h4>We follow up with the advertiser</h4>
            <p>If the advertisement falls short, we raise it directly with whoever placed it.</p>
          </div>
          <div class="tl-item">
            <span class="when">Step 3</span>
            <h4>We act</h4>
            <p>Non-compliant advertising is corrected or removed from the platform.</p>
          </div>
        </div>
        <p class="note">This code sits alongside, and doesn't replace, any statutory advertising standards or regulator that already has authority over a given advertisement.</p>
      </section>

    </main>
  </div>

  <div class="page">
    <footer>
      <div class="brand">Ballylife</div>
      <p>We may update this code from time to time. The version published here is the one that applies.</p>
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

export function AdvertisingPage({ onBack }: { onBack: () => void }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-2.5 border-b border-gray-100 bg-white shrink-0">
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-800">&larr; Back to shopping</button>
      </div>
      <iframe
        ref={iframeRef}
        title="Ballylife Code of Advertising Practice"
        srcDoc={ADVERTISING_PAGE_HTML}
        className="flex-1 w-full border-0"
        style={{ minHeight: 0 }}
      />
    </div>
  );
}
