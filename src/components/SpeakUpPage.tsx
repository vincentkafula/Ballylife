import { PolicyPageFrame } from "./PolicyPageFrame";

// No functional <script> in the supplied design (the report form is a
// static preview -- its "Submit" link is inert via onclick="return
// false;"), but still rendered via an iframe's srcDoc for the same
// reason as the other standalone pages: full isolation of this page's
// own typography/color system (Fraunces + Inter + JetBrains Mono, a
// dark ink hero with a signal-green accent) from the rest of the app.
const SPEAK_UP_PAGE_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Speak Up - Ballylife</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,500;9..144,600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  :root{
    --ink:#14171F;
    --paper:#F7F4EC;
    --paper-dim:#EFEADB;
    --signal:#2F8F6E;
    --amber:#D98B3F;
    --charcoal:#23262B;
    --line:#DAD5C8;
    --line-dark:rgba(247,244,236,0.16);
  }

  *{box-sizing:border-box;}
  html{scroll-behavior:smooth;}
  body{
    margin:0;
    background:var(--paper);
    color:var(--charcoal);
    font-family:'Inter',sans-serif;
    font-size:16px;
    line-height:1.65;
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
    font-size:0.7rem;
    color:var(--amber);
  }

  .hero{
    background:var(--ink);
    color:var(--paper);
    padding:5rem 6vw 3.5rem;
    position:relative;
    overflow:hidden;
  }
  .hero-inner{max-width:720px; position:relative; z-index:2;}
  .hero .brand{
    font-family:'JetBrains Mono',monospace;
    font-size:0.8rem;
    letter-spacing:0.04em;
    color:var(--signal);
    margin-bottom:2.2rem;
    display:flex;
    align-items:center;
    gap:0.6rem;
  }
  .hero .brand::before{
    content:'';
    width:8px;height:8px;
    background:var(--signal);
    border-radius:50%;
    display:inline-block;
    box-shadow:0 0 0 4px rgba(47,143,110,0.18);
  }
  .hero h1{
    color:var(--paper);
    font-size:clamp(2.3rem,5vw,3.6rem);
    line-height:1.1;
    font-weight:600;
    max-width:14ch;
  }
  .hero p.lede{
    margin-top:1.4rem;
    max-width:50ch;
    font-size:1.06rem;
    color:rgba(247,244,236,0.76);
  }

  .trust-strip{
    margin-top:2.4rem;
    display:flex;
    flex-wrap:wrap;
    gap:1.6rem 2.4rem;
  }
  .trust-item{
    display:flex;
    align-items:flex-start;
    gap:0.6rem;
    max-width:210px;
  }
  .trust-item .dot{
    width:6px;height:6px;
    border-radius:50%;
    background:var(--signal);
    margin-top:0.55rem;
    flex-shrink:0;
  }
  .trust-item span.label{
    font-size:0.86rem;
    color:rgba(247,244,236,0.7);
    line-height:1.5;
  }
  .trust-item strong{
    display:block;
    color:var(--paper);
    font-size:0.92rem;
    font-weight:600;
    margin-bottom:0.15rem;
  }

  .cta-row{
    margin-top:2.6rem;
    display:flex;
    gap:1rem;
    flex-wrap:wrap;
  }
  .btn-primary{
    background:var(--signal);
    color:#0D1A16;
    font-family:'Inter',sans-serif;
    font-weight:600;
    font-size:0.92rem;
    padding:0.9rem 1.6rem;
    border:none;
    border-radius:2px;
    cursor:pointer;
    text-decoration:none;
    display:inline-block;
  }
  .btn-ghost{
    background:transparent;
    color:var(--paper);
    font-family:'Inter',sans-serif;
    font-weight:500;
    font-size:0.92rem;
    padding:0.9rem 1.6rem;
    border:1px solid rgba(247,244,236,0.3);
    border-radius:2px;
    cursor:pointer;
    text-decoration:none;
    display:inline-block;
  }

  .signal-graphic{
    position:absolute;
    right:-6%;
    top:8%;
    width:38%;
    opacity:0.55;
    z-index:1;
  }

  .layout{
    display:grid;
    grid-template-columns:250px 1fr;
    max-width:1160px;
    margin:0 auto;
    padding:0 6vw;
  }
  .index-rail{
    padding-top:3.2rem;
    position:sticky;
    top:0;
    align-self:start;
    max-height:100vh;
    overflow-y:auto;
  }
  .index-rail .index-label{
    font-family:'JetBrains Mono',monospace;
    font-size:0.66rem;
    color:#8B8676;
    margin-bottom:1rem;
    padding-bottom:0.6rem;
    border-bottom:1px solid var(--line);
  }
  .index-rail ol{list-style:none; margin:0; padding:0;}
  .index-rail a{
    display:flex;
    gap:0.7rem;
    align-items:baseline;
    text-decoration:none;
    padding:0.5rem 0;
    font-size:0.86rem;
    color:#5B5748;
  }
  .index-rail a:hover{color:var(--signal);}

  main{
    padding:3.2rem 0 6rem 3rem;
    border-left:1px solid var(--line);
    max-width:660px;
  }

  section.clause{
    padding:2.2rem 0;
    border-bottom:1px solid var(--line);
  }
  section.clause:first-child{padding-top:0;}
  section.clause:last-child{border-bottom:none;}
  .clause-head{
    display:flex;
    align-items:baseline;
    gap:0.9rem;
    margin-bottom:0.9rem;
  }
  .clause-head h2{font-size:1.42rem; line-height:1.25;}
  .clause h3{
    font-family:'Inter',sans-serif;
    font-weight:600;
    font-size:0.96rem;
    color:var(--ink);
    margin:1.2rem 0 0.5rem;
  }
  .clause p{margin:0 0 0.85rem; color:#3A3D42; max-width:60ch;}
  .clause p:last-child{margin-bottom:0;}

  .plain-list{margin:0.5rem 0 0; padding-left:1.1rem; color:#3A3D42;}
  .plain-list li{margin-bottom:0.4rem;}

  .callout{
    background:var(--paper-dim);
    border-left:3px solid var(--signal);
    padding:1rem 1.2rem;
    margin-top:1rem;
    font-size:0.92rem;
    color:#4A4636;
  }
  .callout.warn{border-left-color:var(--amber);}

  .channels{
    display:grid;
    grid-template-columns:1fr 1fr;
    gap:0.9rem;
    margin-top:1rem;
  }
  .channel-card{
    background:#fff;
    border:1px solid var(--line);
    padding:1.1rem 1.2rem;
  }
  .channel-card .ch-label{
    font-family:'JetBrains Mono',monospace;
    font-size:0.65rem;
    color:var(--signal);
    display:block;
    margin-bottom:0.5rem;
  }
  .channel-card strong{
    display:block;
    font-family:'Fraunces',serif;
    font-size:1.05rem;
    color:var(--ink);
    margin-bottom:0.3rem;
  }
  .channel-card span.detail{
    font-size:0.88rem;
    color:#5B5748;
  }

  .report-form{
    background:#fff;
    border:1px solid var(--line);
    padding:1.6rem;
    margin-top:1rem;
  }
  .report-form .form-tag{
    font-family:'JetBrains Mono',monospace;
    font-size:0.65rem;
    color:var(--amber);
    margin-bottom:0.9rem;
    display:block;
  }
  .form-row{margin-bottom:1rem;}
  .form-row label{
    display:block;
    font-size:0.84rem;
    font-weight:600;
    color:var(--ink);
    margin-bottom:0.4rem;
  }
  .form-row .hint{
    font-size:0.78rem;
    color:#8B8676;
    font-weight:400;
    margin-left:0.4rem;
  }
  .form-row select,
  .form-row input,
  .form-row textarea{
    width:100%;
    font-family:'Inter',sans-serif;
    font-size:0.9rem;
    padding:0.7rem 0.8rem;
    border:1px solid var(--line);
    background:var(--paper);
    color:var(--charcoal);
    border-radius:2px;
  }
  .form-row textarea{resize:vertical; min-height:100px;}
  .form-toggle{
    display:flex;
    gap:1.4rem;
    margin-bottom:1.2rem;
  }
  .form-toggle label{
    display:flex;
    align-items:center;
    gap:0.5rem;
    font-size:0.88rem;
    font-weight:500;
    color:var(--charcoal);
    cursor:pointer;
  }
  .form-submit-note{
    font-size:0.8rem;
    color:#8B8676;
    margin-top:0.8rem;
  }

  footer{
    background:var(--ink);
    color:rgba(247,244,236,0.7);
    padding:3.2rem 6vw;
    margin-top:2rem;
  }
  footer .footer-inner{
    max-width:1160px;
    margin:0 auto;
    display:flex;
    justify-content:space-between;
    align-items:center;
    flex-wrap:wrap;
    gap:1.5rem;
  }
  footer h3{color:var(--paper); font-size:1.2rem; font-weight:500;}
  footer p{margin:0.4rem 0 0; font-size:0.88rem; max-width:38ch;}
  .help-link{
    font-family:'JetBrains Mono',monospace;
    font-size:0.8rem;
    color:var(--signal);
    text-decoration:none;
    border-bottom:1px solid rgba(47,143,110,0.4);
    padding-bottom:0.2rem;
  }

  @media (max-width:860px){
    .layout{grid-template-columns:1fr;}
    .index-rail{position:relative; max-height:none; padding-top:2rem; overflow:visible;}
    .index-rail ol{display:flex; flex-wrap:wrap; gap:0.2rem 1rem;}
    main{padding:2.2rem 0 4rem 0; border-left:none; max-width:100%;}
    .hero{padding:3rem 6vw 2.6rem;}
    .signal-graphic{display:none;}
    .channels{grid-template-columns:1fr;}
    footer .footer-inner{flex-direction:column; align-items:flex-start;}
  }

  @media (prefers-reduced-motion:reduce){html{scroll-behavior:auto;}}
  :focus-visible{outline:2px solid var(--signal); outline-offset:2px;}
</style>
</head>
<body>

<header class="hero">
  <div class="hero-inner">
    <div class="brand">BALLYLIFE - ETHICS &amp; INTEGRITY</div>
    <h1>Speak up.<br>We're listening.</h1>
    <p class="lede">If you've seen something that doesn't sit right -- fraud, unsafe practices, harassment, or anything that breaks our values -- tell us. Reports are confidential, and you're protected for raising them in good faith.</p>

    <div class="trust-strip">
      <div class="trust-item">
        <span class="dot"></span>
        <span class="label"><strong>Confidential</strong>Only the investigation team sees your report.</span>
      </div>
      <div class="trust-item">
        <span class="dot"></span>
        <span class="label"><strong>Anonymous option</strong>You can report without giving your name.</span>
      </div>
      <div class="trust-item">
        <span class="dot"></span>
        <span class="label"><strong>No retaliation</strong>Good-faith reports are protected, always.</span>
      </div>
    </div>

    <div class="cta-row">
      <a href="#report" class="btn-primary">Make a report</a>
      <a href="#s03" class="btn-ghost">See how it works</a>
    </div>
  </div>

  <svg class="signal-graphic" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg">
    <circle cx="230" cy="90" r="6" fill="var(--signal)" opacity="0.8"/>
    <circle cx="230" cy="90" r="24" stroke="rgba(47,143,110,0.35)" stroke-width="1.2" fill="none"/>
    <circle cx="230" cy="90" r="46" stroke="rgba(47,143,110,0.2)" stroke-width="1.2" fill="none"/>
    <circle cx="230" cy="90" r="70" stroke="rgba(47,143,110,0.1)" stroke-width="1.2" fill="none"/>
    <path d="M 230 90 L 90 320" stroke="rgba(217,139,63,0.4)" stroke-width="1.2" stroke-dasharray="2 7" stroke-linecap="round"/>
    <circle cx="90" cy="320" r="5" fill="var(--amber)" opacity="0.85"/>
  </svg>
</header>

<div class="layout">
  <nav class="index-rail" aria-label="Speak Up index">
    <div class="index-label">SPEAK UP INDEX</div>
    <ol>
      <li><a href="#s01"><span class="code">S.01</span>What to report</a></li>
      <li><a href="#s02"><span class="code">S.02</span>Who can report</a></li>
      <li><a href="#s03"><span class="code">S.03</span>How to report</a></li>
      <li><a href="#s04"><span class="code">S.04</span>Anonymous reporting</a></li>
      <li><a href="#s05"><span class="code">S.05</span>Confidentiality</a></li>
      <li><a href="#s06"><span class="code">S.06</span>No retaliation</a></li>
      <li><a href="#s07"><span class="code">S.07</span>What happens next</a></li>
      <li><a href="#s08"><span class="code">S.08</span>Reporting in good faith</a></li>
      <li><a href="#s09"><span class="code">S.09</span>Other ways to get help</a></li>
      <li><a href="#report"><span class="code">S.10</span>Make a report</a></li>
    </ol>
  </nav>

  <main>

    <section class="clause" id="s01">
      <div class="clause-head"><span class="code">S.01</span><h2>What to report</h2></div>
      <p>Speak Up is for anything that concerns you about how Ballylife or its people are operating -- even if you're not certain it's wrong. It's better to raise it and be wrong than stay quiet and be right. This includes, among other things:</p>
      <ul class="plain-list">
        <li>Fraud, theft, or financial misconduct</li>
        <li>Bribery or corruption</li>
        <li>Health and safety violations</li>
        <li>Harassment, bullying, or discrimination</li>
        <li>Conflicts of interest that haven't been disclosed</li>
        <li>Misuse of customer or employee data</li>
        <li>Environmental violations</li>
        <li>Retaliation against someone who's already reported</li>
      </ul>
    </section>

    <section class="clause" id="s02">
      <div class="clause-head"><span class="code">S.02</span><h2>Who can report</h2></div>
      <p>Speak Up is open to anyone connected to Ballylife -- employees, contractors, suppliers, delivery partners, and customers. You don't need to be directly affected by the issue to raise it; you just need a genuine concern.</p>
    </section>

    <section class="clause" id="s03">
      <div class="clause-head"><span class="code">S.03</span><h2>How to report</h2></div>
      <p>Choose whichever channel feels most comfortable -- they all reach the same independent review team.</p>
      <div class="channels">
        <div class="channel-card">
          <span class="ch-label">ONLINE</span>
          <strong>Report a concern</strong>
          <span class="detail">Use the form at the bottom of this page, any time.</span>
        </div>
        <div class="channel-card">
          <span class="ch-label">HOTLINE</span>
          <strong>Call the Speak Up line</strong>
          <span class="detail"><em>[toll-free hotline number]</em> -- staffed independently of management.</span>
        </div>
        <div class="channel-card">
          <span class="ch-label">EMAIL</span>
          <strong>speakup@ballylife.com</strong>
          <span class="detail">Goes directly to the ethics and integrity team.</span>
        </div>
        <div class="channel-card">
          <span class="ch-label">IN PERSON</span>
          <strong>Talk to someone you trust</strong>
          <span class="detail">A manager, HR, or your local ethics contact can log it for you.</span>
        </div>
      </div>
    </section>

    <section class="clause" id="s04">
      <div class="clause-head"><span class="code">S.04</span><h2>Anonymous reporting</h2></div>
      <p>You can report without giving your name. If you do, we won't be able to follow up with you directly for more detail, so the more specific you can be up front -- dates, names, what you saw -- the easier it is for us to look into it properly. If you're comfortable sharing contact details, we can update you on progress and ask clarifying questions.</p>
    </section>

    <section class="clause" id="s05">
      <div class="clause-head"><span class="code">S.05</span><h2>Confidentiality</h2></div>
      <p>Reports are only shared with the people who need to know to investigate -- never with the person you're reporting, unless disclosure is legally required. Details are handled on a need-to-know basis and kept separate from your everyday employee or account record.</p>
    </section>

    <section class="clause" id="s06">
      <div class="clause-head"><span class="code">S.06</span><h2>No retaliation</h2></div>
      <p>Ballylife does not tolerate retaliation against anyone who raises a concern in good faith -- whether that's demotion, exclusion, harassment, or any other form of reprisal. This protection applies whether or not the concern turns out to be substantiated. If you experience or witness retaliation, report that too, through any of the same channels.</p>
    </section>

    <section class="clause" id="s07">
      <div class="clause-head"><span class="code">S.07</span><h2>What happens next</h2></div>
      <p>Every report gets a case reference number, which you'll receive when you submit -- keep it, especially if you've reported anonymously, so you can check back on progress.</p>
      <ul class="plain-list">
        <li>We acknowledge your report within a few business days</li>
        <li>An independent reviewer assesses whether it needs a formal investigation</li>
        <li>If it does, the investigation is carried out by people outside the area involved</li>
        <li>Where appropriate, we let you know the outcome -- though some details may stay confidential to protect the people involved</li>
      </ul>
    </section>

    <section class="clause" id="s08">
      <div class="clause-head"><span class="code">S.08</span><h2>Reporting in good faith</h2></div>
      <p>You don't need proof -- a genuine, honest concern is enough, even if it turns out to be mistaken. What isn't protected is a report made maliciously or that you know to be false. Deliberately false reports may themselves be treated as misconduct.</p>
    </section>

    <section class="clause" id="s09">
      <div class="clause-head"><span class="code">S.09</span><h2>Other ways to get help</h2></div>
      <p>Speak Up isn't the only route. Depending on the concern, you can also go directly to a relevant regulator, ombud, or law enforcement -- reporting through Speak Up doesn't limit your right to do that.</p>
      <div class="callout warn">If there's an immediate safety risk to someone, contact local emergency services first, and then let us know through Speak Up.</div>
    </section>

    <section class="clause" id="report">
      <div class="clause-head"><span class="code">S.10</span><h2>Make a report</h2></div>
      <p>This form is a preview of what submitting a report looks like -- wire it up to your real intake system before it goes live.</p>
      <div class="report-form">
        <span class="form-tag">CASE INTAKE - PREVIEW</span>

        <div class="form-toggle">
          <label><input type="radio" name="identity" checked> Report anonymously</label>
          <label><input type="radio" name="identity"> Include my contact details</label>
        </div>

        <div class="form-row">
          <label>What's this about? <span class="hint">choose the closest category</span></label>
          <select>
            <option>Fraud or financial misconduct</option>
            <option>Bribery or corruption</option>
            <option>Health and safety</option>
            <option>Harassment or discrimination</option>
            <option>Conflict of interest</option>
            <option>Data or privacy misuse</option>
            <option>Retaliation</option>
            <option>Other</option>
          </select>
        </div>

        <div class="form-row">
          <label>Where and when</label>
          <input type="text" placeholder="e.g. Cape Town warehouse, ongoing since July">
        </div>

        <div class="form-row">
          <label>Tell us what happened <span class="hint">as much detail as you can</span></label>
          <textarea placeholder="Who was involved, what you saw or experienced, and any evidence you have..."></textarea>
        </div>

        <a href="#" class="btn-primary" onclick="return false;">Submit report</a>
        <p class="form-submit-note">You'll receive a case reference number to track this report, even if reporting anonymously.</p>
      </div>
    </section>

  </main>
</div>

<footer>
  <div class="footer-inner">
    <div>
      <h3>Not sure if it's worth reporting?</h3>
      <p>Raise it anyway. Our ethics team would always rather hear a false alarm than miss a real one.</p>
    </div>
    <a class="help-link" href="#s03">See reporting channels</a>
  </div>
</footer>

</body>
</html>`;

export function SpeakUpPage({ onBack }: { onBack: () => void }) {
  return <PolicyPageFrame title="Ballylife Speak Up" srcDoc={SPEAK_UP_PAGE_HTML} onBack={onBack} />;
}
