import { PolicyPageFrame } from "./PolicyPageFrame";

// No <script> in the supplied design (purely CSS-driven: sticky rail,
// smooth-scroll anchors), but still rendered via an iframe's srcDoc for
// the same reason as ContactPage.tsx/TermsPage.tsx: full isolation of
// this page's own typography/color system (Fraunces + Karla, a warm
// pine-and-paper palette) from the rest of the app's Tailwind styles.
const HUMAN_RIGHTS_PAGE_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Human Rights Statement - Ballylife</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Karla:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{
    --ink: #22302A;
    --paper: #F7F4EA;
    --paper-deep: #EEE8D6;
    --paper-line: #E4DEC8;
    --pine: #1F362B;
    --pine-soft: #40594A;
    --moss: #A9BFA6;
    --gold: #B0873F;
    --gold-soft: #DCC492;
    --rust: #A85A3B;
    --line: rgba(31,54,43,0.15);
    --content-max: 700px;
    --page-max: 1160px;
  }

  *{ box-sizing: border-box; }
  html{ scroll-behavior: smooth; }

  body{
    margin:0;
    background: var(--paper);
    color: var(--ink);
    font-family: 'Karla', sans-serif;
    font-size: 17px;
    line-height: 1.7;
    -webkit-font-smoothing: antialiased;
  }

  h1, h2, h3, h4, .display{
    font-family: 'Fraunces', serif;
    color: var(--pine);
    margin: 0;
    font-weight: 500;
  }

  a{ color: inherit; }

  .page{
    max-width: var(--page-max);
    margin: 0 auto;
    padding: 0 32px;
  }

  .topbar{
    position: sticky;
    top: 0;
    z-index: 20;
    background: rgba(247,244,234,0.92);
    backdrop-filter: blur(6px);
    border-bottom: 1px solid var(--line);
  }

  .topbar-inner{
    max-width: var(--page-max);
    margin: 0 auto;
    padding: 16px 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .wordmark{
    font-family: 'Fraunces', serif;
    font-size: 18px;
    color: var(--pine);
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .wordmark small{
    font-family: 'Karla', sans-serif;
    font-size: 12px;
    color: var(--pine-soft);
    letter-spacing: 0.02em;
  }

  .topbar nav{
    display: flex;
    gap: 26px;
    font-size: 14px;
  }

  .topbar nav a{
    color: var(--pine-soft);
    text-decoration: none;
    border-bottom: 1px solid transparent;
    padding-bottom: 2px;
    transition: border-color 0.15s ease, color 0.15s ease;
  }

  .topbar nav a:hover{ color: var(--pine); border-color: var(--gold); }

  @media (max-width: 780px){
    .topbar nav{ display: none; }
  }

  .hero{
    background:
      radial-gradient(900px 420px at 15% -15%, rgba(169,191,166,0.30), transparent 60%),
      radial-gradient(700px 500px at 100% 0%, rgba(176,135,63,0.16), transparent 55%),
      linear-gradient(180deg, var(--pine) 0%, #17281f 100%);
    color: var(--paper);
    position: relative;
    overflow: hidden;
  }

  .hero-inner{
    max-width: var(--page-max);
    margin: 0 auto;
    padding: 92px 32px 84px;
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 40px;
    align-items: end;
    position: relative;
  }

  .hero-rings{
    position: absolute;
    right: -60px;
    top: -80px;
    width: 360px;
    height: 360px;
    pointer-events: none;
  }

  .hero-rings circle{
    fill: none;
    stroke: rgba(246,243,234,0.14);
  }

  .kicker{
    font-family:'Fraunces', serif;
    font-style: italic;
    font-size: 17px;
    color: var(--gold-soft);
    margin-bottom: 20px;
    display: block;
  }

  .hero h1{
    color: var(--paper);
    font-size: clamp(32px, 4.6vw, 50px);
    line-height: 1.14;
    max-width: 13ch;
  }

  .hero-meta{
    border-left: 1px solid rgba(246,243,234,0.28);
    padding-left: 24px;
    font-size: 14.5px;
    color: #D8E0D2;
  }

  .hero-meta dl{ margin: 0; }
  .hero-meta dt{ color: var(--gold-soft); font-family: 'Fraunces', serif; font-style: italic; font-size: 13.5px; margin-bottom: 4px; }
  .hero-meta dd{ margin: 0 0 18px; }
  .hero-meta dd:last-child{ margin-bottom: 0; }

  .hero p.lede{
    grid-column: 1 / -1;
    margin: 26px 0 0;
    max-width: 62ch;
    font-size: 18.5px;
    color: #DCE3D4;
    border-top: 1px solid rgba(246,243,234,0.16);
    padding-top: 26px;
  }

  @media (max-width: 780px){
    .hero-inner{ grid-template-columns: 1fr; padding: 64px 24px 56px; }
    .hero-meta{ border-left: none; padding-left: 0; border-top: 1px solid rgba(246,243,234,0.2); padding-top: 18px; }
  }

  .body-grid{
    max-width: var(--page-max);
    margin: 0 auto;
    padding: 0 32px;
    display: grid;
    grid-template-columns: 200px 1fr;
    gap: 56px;
    align-items: start;
  }

  .rail{
    position: sticky;
    top: 78px;
    padding-top: 64px;
    font-size: 14px;
  }

  .rail-title{
    font-family: 'Fraunces', serif;
    font-style: italic;
    color: var(--gold);
    font-size: 13.5px;
    margin-bottom: 14px;
  }

  .rail a{
    display: block;
    padding: 7px 0;
    color: var(--pine-soft);
    text-decoration: none;
    border-left: 2px solid transparent;
    padding-left: 12px;
    margin-left: -13px;
    transition: color 0.15s ease, border-color 0.15s ease;
  }

  .rail a:hover{ color: var(--pine); border-color: var(--gold); }

  @media (max-width: 960px){
    .body-grid{ grid-template-columns: 1fr; }
    .rail{ display: none; }
  }

  .content{ min-width: 0; }

  section{
    padding: 60px 0;
    border-bottom: 1px solid var(--line);
    max-width: var(--content-max);
  }

  section:first-of-type{ padding-top: 68px; }
  section:last-of-type{ border-bottom: none; }

  .eyebrow{
    font-family:'Fraunces', serif;
    font-style: italic;
    color: var(--gold);
    font-size: 15px;
    margin-bottom: 12px;
    display: block;
  }

  h2{
    font-size: clamp(23px, 3vw, 29px);
    max-width: 20ch;
  }

  .lead-para{
    font-size: 18.5px;
    color: var(--pine-soft);
    max-width: 58ch;
    margin-top: 16px;
  }

  p{ margin: 15px 0; max-width: 62ch; }

  ul.plain{ margin: 15px 0; padding-left: 20px; }
  ul.plain li{ margin: 6px 0; }

  .two-col{
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 32px;
    margin-top: 30px;
  }

  .pillar{
    background: var(--paper-deep);
    border: 1px solid var(--paper-line);
    padding: 24px 24px 26px;
  }

  .pillar h3{ font-size: 19px; margin-bottom: 8px; }
  .pillar p{ font-size: 15.5px; margin: 8px 0 0; }

  .pillar-mark{
    width: 32px; height: 32px;
    border-radius: 50%;
    border: 1px solid var(--gold);
    display:flex; align-items:center; justify-content:center;
    margin-bottom: 14px;
  }
  .pillar-mark span{ width: 7px; height: 7px; background: var(--gold); border-radius: 50%; display:block; }

  @media (max-width: 640px){ .two-col{ grid-template-columns: 1fr; } }

  .quote-block{
    background: var(--paper-deep);
    border-left: 3px solid var(--gold);
    padding: 26px 30px;
    margin: 28px 0 8px;
    font-family:'Fraunces', serif;
    font-size: 19.5px;
    color: var(--pine);
    font-style: italic;
    line-height: 1.5;
  }

  .chips{ display:flex; flex-wrap: wrap; gap: 10px; margin: 22px 0 4px; }
  .chip{
    font-size: 13.5px;
    padding: 7px 14px;
    border: 1px solid var(--pine);
    color: var(--pine);
    border-radius: 999px;
  }

  .steps{
    margin-top: 30px;
    counter-reset: step;
  }

  .step{
    display: grid;
    grid-template-columns: 44px 1fr;
    gap: 18px;
    padding: 20px 0;
    border-top: 1px solid var(--line);
  }
  .step:last-child{ border-bottom: 1px solid var(--line); }

  .step-num{
    counter-increment: step;
    font-family: 'Fraunces', serif;
    font-size: 20px;
    color: var(--gold);
  }
  .step-num::before{ content: counter(step, decimal-leading-zero); }

  .step h4{ font-size: 17px; margin-bottom: 5px; }
  .step p{ font-size: 15.5px; margin: 0; }

  .principles{
    margin-top: 30px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    border-top: 1px solid var(--line);
  }
  .principle{
    padding: 17px 0;
    border-bottom: 1px solid var(--line);
    font-size: 15.5px;
  }
  .principle:nth-child(odd){ padding-right: 22px; border-right: 1px solid var(--line); }
  .principle:nth-child(even){ padding-left: 22px; }
  .principle strong{
    font-family:'Fraunces', serif;
    font-weight: 500;
    color: var(--pine);
    display:block;
    margin-bottom: 3px;
    font-size: 16px;
  }
  @media (max-width: 640px){
    .principles{ grid-template-columns: 1fr; }
    .principle:nth-child(odd){ padding-right: 0; border-right: none; }
    .principle:nth-child(even){ padding-left: 0; }
  }

  .expect-list{ margin-top: 26px; }
  .expect{
    display: grid;
    grid-template-columns: 22px 1fr;
    gap: 14px;
    padding: 14px 0;
    border-top: 1px solid var(--line);
    font-size: 16px;
  }
  .expect:last-child{ border-bottom: 1px solid var(--line); }
  .expect .mark{ color: var(--gold); font-family:'Fraunces', serif; font-style: italic; }

  .gov-grid{ margin-top: 26px; display: grid; gap: 16px; }
  .gov-item{
    display: grid;
    grid-template-columns: 108px 1fr;
    gap: 20px;
    padding: 18px 0;
    border-top: 1px solid var(--line);
  }
  .gov-item:last-child{ border-bottom: 1px solid var(--line); }
  .gov-item .tag{ font-family:'Fraunces', serif; font-style: italic; color: var(--gold); font-size: 15px; }
  .gov-item p{ margin: 0; font-size: 15.5px; max-width: 56ch; }
  @media (max-width: 640px){ .gov-item{ grid-template-columns: 1fr; gap: 6px; } }

  .grievance-box{
    margin-top: 28px;
    background: var(--pine);
    color: var(--paper);
    padding: 30px 32px;
    display: grid;
    gap: 16px;
  }
  .grievance-box h3{ color: var(--paper); font-size: 20px; }
  .grievance-box p{ color: #DCE3D4; font-size: 15.5px; margin: 0; max-width: 56ch; }
  .grievance-box .routes{ display:flex; flex-wrap: wrap; gap: 10px; margin-top: 4px; }
  .grievance-box .route{
    font-size: 13.5px;
    padding: 8px 14px;
    border: 1px solid rgba(246,243,234,0.4);
    color: var(--paper);
    border-radius: 999px;
  }

  footer{
    max-width: var(--content-max);
    padding: 44px 0 84px;
    color: var(--pine-soft);
    font-size: 14px;
  }
  footer .brand{ font-family:'Fraunces', serif; color: var(--pine); font-size: 16px; margin-bottom: 6px; }
</style>
</head>
<body>

  <div class="topbar">
    <div class="topbar-inner">
      <div class="wordmark">Ballylife <small>Human Rights Statement</small></div>
      <nav>
        <a href="#approach">Approach</a>
        <a href="#standards">Standards</a>
        <a href="#workforce">Workforce</a>
        <a href="#suppliers">Suppliers</a>
        <a href="#governance">Governance</a>
        <a href="#grievance">Report a concern</a>
      </nav>
    </div>
  </div>

  <header class="hero">
    <div class="hero-inner">
      <svg class="hero-rings" viewBox="0 0 360 360" aria-hidden="true">
        <circle cx="180" cy="180" r="178"/>
        <circle cx="180" cy="180" r="128"/>
      </svg>
      <div>
        <span class="kicker">Ballylife - Human Rights Statement</span>
        <h1>Human dignity is not negotiable in how we do business.</h1>
      </div>
      <div class="hero-meta">
        <dl>
          <dt>Applies to</dt>
          <dd>Our employees, our suppliers, and the communities our operations touch</dd>
          <dt>Grounded in</dt>
          <dd>UN Guiding Principles, UDHR, ILO core standards</dd>
        </dl>
      </div>
      <p class="lede">This statement sets out how we uphold the standards of the Universal Declaration of Human Rights and the UN Guiding Principles on Business and Human Rights -- across our people, our partners, and everyone our work touches.</p>
    </div>
  </header>

  <div class="body-grid">
    <aside class="rail">
      <div class="rail-title">On this page</div>
      <a href="#why">Why this matters</a>
      <a href="#approach">Our approach</a>
      <a href="#standards">Standards we follow</a>
      <a href="#process">Our due diligence process</a>
      <a href="#workforce">Our workforce</a>
      <a href="#suppliers">Our suppliers</a>
      <a href="#governance">Governance &amp; reporting</a>
      <a href="#grievance">Raising a concern</a>
    </aside>

    <main class="content">

      <section id="why">
        <span class="eyebrow">Why this matters</span>
        <h2>A baseline, not an aspiration</h2>
        <p class="lead-para">The Universal Declaration of Human Rights describes the minimum conditions every person is owed in order to live with dignity. We treat that as a floor, not a target to reach for someday -- it shapes decisions we make today, from how we treat colleagues to who we choose to work with.</p>
        <p>Every part of Ballylife carries a share of that responsibility. Where our decisions touch people directly -- our teams, our partners, the communities around our operations -- we hold ourselves to the same standard we'd want applied to us. This statement is our public account of what that looks like in practice, and how we check ourselves against it.</p>
      </section>

      <section id="approach">
        <span class="eyebrow">Where our responsibility runs deepest</span>
        <h2>Our approach: two relationships we take most seriously</h2>
        <p class="lead-para">Beyond the indirect impact we have across the communities where we operate, our most direct responsibility sits with the people who work for us and the businesses we choose to work with.</p>
        <div class="two-col">
          <div class="pillar">
            <div class="pillar-mark"><span></span></div>
            <h3>Our people</h3>
            <p>Everyone who works with Ballylife is owed a workplace that is safe, fair, and free of abuse or exploitation. That expectation travels with our teams wherever they're working and however that work is organised, and it applies equally at every level of the business.</p>
          </div>
          <div class="pillar">
            <div class="pillar-mark"><span></span></div>
            <h3>Our partners</h3>
            <p>We choose who we buy from and work with, and that choice carries weight. We look for partners who hold themselves to comparable standards, and we use our purchasing decisions deliberately rather than treating supplier conduct as someone else's problem.</p>
          </div>
        </div>
      </section>

      <section id="standards">
        <span class="eyebrow">How we hold ourselves to it</span>
        <h2>The standards guiding our commitment</h2>
        <p class="lead-para">We look to established international frameworks as the reference points for how a business should behave -- not because they're mandatory everywhere we operate, but because they represent the clearest thinking available on the subject.</p>
        <div class="chips">
          <span class="chip">UN Guiding Principles on Business &amp; Human Rights</span>
          <span class="chip">OECD Guidelines for Multinational Enterprises</span>
          <span class="chip">UN Global Compact</span>
          <span class="chip">ILO Core Labour Standards</span>
        </div>
        <div class="quote-block">
          Where local law and international human rights standards genuinely conflict, we follow the law -- and still look for every available way to honour the spirit of those broader principles.
        </div>
        <p>Internal policies translate that commitment into practice: how we hire and manage people fairly, how we protect health and safety, and how we handle privacy and confidential information. We're working continuously to identify where our impact could be harmful and to close those gaps before they cause harm -- we don't consider this work finished, and we don't expect to.</p>
      </section>

      <section id="process">
        <span class="eyebrow">Turning commitment into practice</span>
        <h2>Our due diligence process</h2>
        <p class="lead-para">Meeting a commitment like this takes an ongoing process, not a one-time policy. We follow four steps to keep our impact honest.</p>
        <div class="steps">
          <div class="step">
            <div class="step-num"></div>
            <div>
              <h4>Identify</h4>
              <p>We look across our own operations and our supply chain for places where our activity could put someone's rights at risk, before a problem surfaces on its own.</p>
            </div>
          </div>
          <div class="step">
            <div class="step-num"></div>
            <div>
              <h4>Prevent</h4>
              <p>Where a risk is foreseeable, we build safeguards into policy, contracts, and day-to-day decisions so the risk doesn't turn into harm.</p>
            </div>
          </div>
          <div class="step">
            <div class="step-num"></div>
            <div>
              <h4>Mitigate</h4>
              <p>Where a risk can't be removed outright, we work to reduce its likelihood and severity, and to keep watching it over time.</p>
            </div>
          </div>
          <div class="step">
            <div class="step-num"></div>
            <div>
              <h4>Remediate</h4>
              <p>Where harm has already occurred, we act on it -- through our governance framework and internal policies -- rather than treating disclosure as the end of our responsibility.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="workforce">
        <span class="eyebrow">What we protect for our workforce</span>
        <h2>Principles drawn from the ILO's core labour standards</h2>
        <p class="lead-para">These are the specific commitments we make to everyone who works for Ballylife, based on the International Labour Organisation's Declaration on Fundamental Principles and Rights at Work.</p>
        <div class="principles">
          <div class="principle"><strong>Fair employment</strong>Free from discrimination in hiring, pay, and advancement.</div>
          <div class="principle"><strong>Dignity at work</strong>Respectful treatment, free from harassment or abuse.</div>
          <div class="principle"><strong>Privacy</strong>Confidentiality of personal and employee information.</div>
          <div class="principle"><strong>No forced labour</strong>Zero tolerance for coercion or trafficking, in any form.</div>
          <div class="principle"><strong>No child labour</strong>Zero tolerance, without exception, anywhere in our operations.</div>
          <div class="principle"><strong>Equal opportunity</strong>Access and advancement judged on merit alone.</div>
          <div class="principle"><strong>Health &amp; safety</strong>A working environment that doesn't put people at risk.</div>
          <div class="principle"><strong>Fair pay</strong>Remuneration that honestly reflects the work done.</div>
          <div class="principle"><strong>Freedom of association</strong>The right to organise and bargain collectively.</div>
        </div>
      </section>

      <section id="suppliers">
        <span class="eyebrow">Extending the standard outward</span>
        <h2>What we expect from suppliers</h2>
        <p class="lead-para">We're mindful of the influence our purchasing decisions have on the businesses that supply us. Any company that wants to work with Ballylife is expected to meet a standard compatible with our own.</p>
        <div class="expect-list">
          <div class="expect"><span class="mark">-</span><span>No use of forced, bonded, or child labour anywhere in their operations.</span></div>
          <div class="expect"><span class="mark">-</span><span>Safe working conditions and fair treatment for their own employees.</span></div>
          <div class="expect"><span class="mark">-</span><span>Freedom for their workers to organise and raise concerns without retaliation.</span></div>
          <div class="expect"><span class="mark">-</span><span>Willingness to be reviewed, and to correct issues we or they identify.</span></div>
        </div>
      </section>

      <section id="governance">
        <span class="eyebrow">Keeping ourselves accountable</span>
        <h2>Governance, monitoring, and reporting</h2>
        <p class="lead-para">A statement is only as good as the structure that enforces it. Here's what sits behind ours.</p>
        <div class="gov-grid">
          <div class="gov-item">
            <span class="tag">Oversight</span>
            <p>Responsibility for our human rights commitments sits within our sustainability governance, with clear ownership rather than a diffuse mandate.</p>
          </div>
          <div class="gov-item">
            <span class="tag">Review</span>
            <p>Our teams regularly assess the performance of our own programmes and check activity across our supply chain against the standards we've set.</p>
          </div>
          <div class="gov-item">
            <span class="tag">Response</span>
            <p>Reported concerns are investigated, and where a violation is found, we act on it through remediation measures set out in our internal policies.</p>
          </div>
          <div class="gov-item">
            <span class="tag">Improvement</span>
            <p>We know there's more to understand about our impact, so we're deliberately widening how we look at it rather than treating this as settled.</p>
          </div>
        </div>
      </section>

      <section id="grievance">
        <span class="eyebrow">If something isn't right</span>
        <h2>Raising a concern</h2>
        <p class="lead-para">Anyone -- an employee, a supplier's worker, or a member of the public -- can raise a concern about a possible human rights impact connected to Ballylife.</p>
        <div class="grievance-box">
          <h3>How reports are handled</h3>
          <p>Every report is looked into. Where an investigation finds a genuine violation, we take corrective action through our governance framework, and we protect anyone who reports in good faith from retaliation.</p>
          <div class="routes">
            <span class="route">Line manager or HR contact</span>
            <span class="route">Confidential reporting channel</span>
            <span class="route">Supplier relationship contact</span>
          </div>
        </div>
      </section>

    </main>
  </div>

  <div class="page">
    <footer>
      <div class="brand">Ballylife</div>
      <p>This statement is reviewed periodically as our understanding of our human rights impact evolves.</p>
    </footer>
  </div>

</body>
</html>`;

export function HumanRightsPage({ onBack }: { onBack: () => void }) {
  return <PolicyPageFrame title="Ballylife Human Rights Statement" srcDoc={HUMAN_RIGHTS_PAGE_HTML} onBack={onBack} />;
}
