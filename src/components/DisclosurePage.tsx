import { PolicyPageFrame } from "./PolicyPageFrame";

// Has its own scroll-spy <script> (highlights the active section in both
// the sidebar rail and top nav as the reader scrolls) -- rendered via an
// iframe's srcDoc for the same reason as the other standalone pages:
// dangerouslySetInnerHTML never executes injected <script> tags, and the
// iframe keeps this page's bespoke typography/color system fully
// isolated from the rest of the app.
const DISCLOSURE_PAGE_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Responsible Disclosure Policy - Ballylife</title>
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
    --crit: #A0432E;
    --high: #B0703F;
    --med: #B0873F;
    --low: #7C8F6E;
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

  h1, h2, h3, h4{
    font-family: 'Fraunces', serif;
    color: var(--pine);
    margin: 0;
    font-weight: 500;
  }

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
  .wordmark{
    font-family: 'Fraunces', serif; font-size: 18px; color: var(--pine);
    display: flex; align-items: baseline; gap: 8px; white-space: nowrap;
  }
  .wordmark small{ font-family: var(--mono); font-size: 11px; color: var(--pine-soft); }
  .topbar nav{ display: flex; gap: 22px; font-size: 13.5px; overflow-x: auto; }
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
      radial-gradient(900px 460px at 10% -25%, rgba(176,135,63,0.22), transparent 60%),
      radial-gradient(700px 420px at 100% 10%, rgba(64,89,74,0.35), transparent 55%),
      linear-gradient(180deg, var(--pine) 0%, #14211a 100%);
    color: var(--paper);
    position: relative;
    overflow: hidden;
  }
  .hero-grid-lines{
    position: absolute; inset: 0; opacity: 0.07;
    background-image:
      linear-gradient(90deg, var(--paper) 1px, transparent 1px),
      linear-gradient(0deg, var(--paper) 1px, transparent 1px);
    background-size: 56px 56px;
    mask-image: linear-gradient(180deg, black, transparent 85%);
  }
  .hero-inner{
    max-width: var(--page-max); margin: 0 auto; padding: 88px 32px 0;
    position: relative;
  }
  .kicker{
    font-family: var(--mono); font-size: 13px; letter-spacing: 0.03em;
    color: var(--gold-soft); margin-bottom: 20px; display: flex; align-items: center; gap: 10px;
  }
  .kicker .dot-pulse{
    width: 7px; height: 7px; border-radius: 50%; background: var(--gold-soft);
  }
  .hero h1{
    color: var(--paper); font-size: clamp(32px, 4.8vw, 50px); line-height: 1.12; max-width: 15ch;
  }
  .hero p.lede{ margin: 24px 0 0; max-width: 58ch; font-size: 18px; color: #D8E0D2; }

  .hero-stats{
    margin-top: 44px;
    display: grid; grid-template-columns: repeat(4, 1fr);
    border-top: 1px solid rgba(246,243,234,0.18);
  }
  .hero-stat{ padding: 22px 24px 26px 0; border-right: 1px solid rgba(246,243,234,0.18); }
  .hero-stat:last-child{ border-right: none; padding-right: 0; }
  .hero-stat .num{ font-family: 'Fraunces', serif; font-size: 26px; color: var(--gold-soft); }
  .hero-stat .lbl{ font-size: 13px; color: #C9D3C2; margin-top: 4px; }
  @media (max-width: 780px){
    .hero-inner{ padding: 60px 24px 0; }
    .hero-stats{ grid-template-columns: 1fr 1fr; }
    .hero-stat{ border-right: none; border-bottom: 1px solid rgba(246,243,234,0.18); padding: 18px 0; }
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

  .safe-harbor{
    margin-top: 26px; background: var(--paper-deep); border: 1px solid var(--paper-line);
    padding: 22px 26px; display: flex; gap: 16px; align-items: flex-start;
  }
  .safe-harbor svg{ flex: none; margin-top: 3px; }
  .safe-harbor p{ margin: 0; font-size: 15.5px; }
  .safe-harbor strong{ color: var(--pine); }

  .rules-list{ margin-top: 26px; display: grid; gap: 0; }
  .rule{
    display: grid; grid-template-columns: 26px 1fr; gap: 14px;
    padding: 14px 0; border-top: 1px solid var(--line); font-size: 15.5px;
  }
  .rule:last-child{ border-bottom: 1px solid var(--line); }
  .rule .ico{ color: var(--gold); }

  .report-box{
    margin-top: 26px; background: var(--pine); color: var(--paper); padding: 28px 30px;
  }
  .report-box h3{ color: var(--paper); font-size: 18px; margin-bottom: 10px; }
  .report-box p{ color: #D8E0D2; font-size: 15.5px; margin: 0 0 16px; max-width: 56ch; }
  .report-box .addr{
    font-family: var(--mono); font-size: 17px; color: var(--gold-soft);
    display: inline-block; border-bottom: 1px dashed rgba(220,196,146,0.5);
  }
  .report-box .pgp{ margin-top: 14px; font-size: 13px; color: #B7C4AF; }

  ol.req{ margin: 22px 0 0; padding-left: 0; list-style: none; counter-reset: req; }
  ol.req li{
    counter-increment: req; position: relative; padding: 13px 0 13px 36px;
    border-top: 1px solid var(--line); font-size: 15.5px;
  }
  ol.req li:last-child{ border-bottom: 1px solid var(--line); }
  ol.req li::before{
    content: counter(req, decimal-leading-zero);
    position: absolute; left: 0; top: 13px;
    font-family: var(--mono); color: var(--gold); font-size: 13px;
  }
  ol.req li strong{ color: var(--pine); display: block; font-family: 'Fraunces', serif; font-weight: 500; font-size: 15.5px; }

  .scope-cols{ display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 28px; }
  .scope-col h4{ font-size: 15px; display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
  .dot{ width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
  .dot.ok{ background: var(--ok); }
  .dot.no{ background: var(--no); }
  .scope-col ul{ list-style: none; margin: 0; padding: 0; }
  .scope-col li{ font-size: 15px; padding: 10px 0; border-top: 1px solid var(--line); }
  .scope-col li:last-child{ border-bottom: 1px solid var(--line); }
  @media (max-width: 640px){ .scope-cols{ grid-template-columns: 1fr; } }

  .domains{ margin-top: 22px; display: flex; flex-wrap: wrap; gap: 10px; }
  .domains span{
    font-family: var(--mono); font-size: 13px; color: var(--pine);
    border: 1px solid var(--pine); padding: 6px 12px; border-radius: 999px;
  }

  .sev-table{ margin-top: 28px; border-top: 1px solid var(--line); }
  .sev-row{
    display: grid; grid-template-columns: 130px 1fr 130px;
    gap: 18px; padding: 16px 0; border-bottom: 1px solid var(--line); align-items: center;
  }
  .sev-row.head{ font-family: var(--mono); font-size: 12px; color: var(--pine-soft); letter-spacing: 0.02em; }
  .sev-pill{
    font-family: var(--mono); font-size: 12.5px; padding: 5px 10px; border-radius: 4px;
    display: inline-block; color: var(--paper); width: fit-content;
  }
  .sev-pill.critical{ background: var(--crit); }
  .sev-pill.high{ background: var(--high); }
  .sev-pill.medium{ background: var(--med); }
  .sev-pill.low{ background: var(--low); }
  .sev-row .desc{ font-size: 15px; }
  .sev-row .sla{ font-family: var(--mono); font-size: 13.5px; color: var(--pine-soft); text-align: right; }
  @media (max-width: 640px){
    .sev-row{ grid-template-columns: 1fr; gap: 6px; }
    .sev-row .sla{ text-align: left; }
  }

  .tagcloud{ display: flex; flex-wrap: wrap; gap: 9px; margin-top: 24px; }
  .tagcloud span{
    font-family: var(--mono); font-size: 12.5px; color: var(--pine-soft);
    border: 1px solid var(--paper-line); background: var(--paper-deep); padding: 7px 12px;
  }

  .timeline{ margin-top: 32px; position: relative; padding-left: 28px; }
  .timeline::before{
    content: ""; position: absolute; left: 5px; top: 6px; bottom: 6px;
    width: 1px; background: var(--paper-line);
  }
  .tl-item{ position: relative; padding-bottom: 30px; }
  .tl-item:last-child{ padding-bottom: 0; }
  .tl-item::before{
    content: ""; position: absolute; left: -28px; top: 4px;
    width: 11px; height: 11px; border-radius: 50%;
    background: var(--paper); border: 2px solid var(--gold);
  }
  .tl-item h4{ font-size: 17px; margin-bottom: 5px; }
  .tl-item p{ font-size: 15.5px; margin: 0; }
  .tl-item .when{ font-family: var(--mono); font-size: 12px; color: var(--gold); display: block; margin-bottom: 6px; }

  .note{
    margin-top: 22px; font-size: 14.5px; color: var(--pine-soft);
    border-left: 2px solid var(--gold-soft); padding-left: 16px;
  }

  .faq-item{ padding: 20px 0; border-top: 1px solid var(--line); }
  .faq-item:last-child{ border-bottom: 1px solid var(--line); }
  .faq-item h4{ font-size: 16.5px; margin-bottom: 8px; }
  .faq-item p{ font-size: 15.5px; margin: 0; }

  .recognition-box{
    margin-top: 26px; border: 1px dashed var(--gold); padding: 24px 26px;
    display: flex; gap: 18px; align-items: flex-start;
  }
  .recognition-box svg{ flex: none; margin-top: 2px; }
  .recognition-box p{ margin: 0; font-size: 15.5px; }

  .page{ max-width: var(--page-max); margin: 0 auto; padding: 0 32px; }
  footer{ max-width: var(--content-max); padding: 46px 0 88px; color: var(--pine-soft); font-size: 14px; }
  footer .brand{ font-family: 'Fraunces', serif; color: var(--pine); font-size: 16px; margin-bottom: 6px; }
</style>
</head>
<body>

  <div class="topbar">
    <div class="topbar-inner">
      <div class="wordmark">Ballylife <small>/security</small></div>
      <nav id="topnav">
        <a href="#intro">Introduction</a>
        <a href="#rules">Ground rules</a>
        <a href="#reporting">Reporting</a>
        <a href="#scope">Scope</a>
        <a href="#severity">Severity &amp; SLA</a>
        <a href="#non-qualifying">Exclusions</a>
        <a href="#commitment">Commitment</a>
        <a href="#faq">FAQ</a>
      </nav>
      <a class="contact-btn" href="mailto:security@ballylife.com">security@ballylife.com</a>
    </div>
  </div>

  <header class="hero">
    <div class="hero-grid-lines" aria-hidden="true"></div>
    <div class="hero-inner">
      <span class="kicker"><span class="dot-pulse"></span>Ballylife &middot; Security</span>
      <h1>Responsible Disclosure Policy</h1>
      <p class="lede">If you've found a security weakness in Ballylife's website or service, we want to hear about it. This page sets out how to report it, what's in scope, how quickly we respond, and what happens once you do.</p>
      <div class="hero-stats">
        <div class="hero-stat"><div class="num">Safe</div><div class="lbl">harbour for good-faith research</div></div>
        <div class="hero-stat"><div class="num">4</div><div class="lbl">severity tiers with target response times</div></div>
        <div class="hero-stat"><div class="num">1st</div><div class="lbl">valid reporter of an issue is recognised</div></div>
        <div class="hero-stat"><div class="num">0</div><div class="lbl">monetary bounty -- recognition instead</div></div>
      </div>
    </div>
  </header>

  <div class="body-grid">
    <aside class="rail">
      <div class="rail-title">On this page</div>
      <a href="#intro">Introduction</a>
      <a href="#rules">Ground rules</a>
      <a href="#reporting">How to report</a>
      <a href="#scope">Scope</a>
      <a href="#severity">Severity &amp; response times</a>
      <a href="#non-qualifying">What doesn't qualify</a>
      <a href="#commitment">Our commitment</a>
      <a href="#faq">FAQ</a>
    </aside>

    <main class="content">

      <section id="intro">
        <span class="eyebrow">Introduction</span>
        <h2>Why we welcome this</h2>
        <p class="lead-para">Ballylife is built around trust, and keeping our platform secure is part of earning it. We know that outside researchers often spot things our own testing misses, and we'd rather hear from you directly than find out some other way.</p>
        <p>This policy explains how to tell us about a vulnerability responsibly, what we ask you not to do while researching it, and what you can expect from us in return.</p>
        <div class="safe-harbor">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" stroke="#B0873F" stroke-width="1.6"/></svg>
          <p><strong>Safe harbour.</strong> If you report a vulnerability in good faith and stay within the boundaries set out on this page, Ballylife will not pursue legal action against you or restrict your access to our services because of your research.</p>
        </div>
        <p>If you're a Ballylife customer and think your own account has been compromised, that's a different situation -- please contact our support team directly rather than using the process below, so it can be handled urgently.</p>
      </section>

      <section id="rules">
        <span class="eyebrow">Before you start testing</span>
        <h2>Ground rules for researchers</h2>
        <p class="lead-para">These are the conditions your research needs to stay within for this policy's protections to apply.</p>
        <div class="rules-list">
          <div class="rule"><span class="ico">-</span><span>Only test against your own account, or a test account you've created and can identify to us.</span></div>
          <div class="rule"><span class="ico">-</span><span>Keep your findings private until we've confirmed a fix -- no public write-ups, talks, or social posts in the meantime.</span></div>
          <div class="rule"><span class="ico">-</span><span>Don't tell anyone else what you've found, including friends or colleagues, while the report is open.</span></div>
          <div class="rule"><span class="ico">-</span><span>Stop and email us the moment you suspect you can reach another customer's account or data.</span></div>
          <div class="rule"><span class="ico">-</span><span>Give us a reasonable window to investigate and fix an issue before discussing it anywhere publicly.</span></div>
        </div>
      </section>

      <section id="reporting">
        <span class="eyebrow">Reporting a vulnerability</span>
        <h2>How to tell us what you've found</h2>
        <p class="lead-para">Send your report by email -- please don't use any other channel or platform to reach us about a vulnerability.</p>
        <div class="report-box">
          <h3>Send your report to</h3>
          <p>Use a test account you control, and be ready to identify it in your report.</p>
          <a class="addr" href="mailto:security@ballylife.com">security@ballylife.com</a>
          <div class="pgp">Prefer to encrypt your report? Ask us for our current PGP key before sending anything sensitive.</div>
        </div>
        <ol class="req">
          <li><strong>Location</strong>The exact page, endpoint, or parameter where the issue occurs.</li>
          <li><strong>Vulnerability type</strong>What kind of issue it is, described clearly and in plain language.</li>
          <li><strong>Reproduction steps</strong>A numbered, step-by-step path we can follow to see it ourselves.</li>
          <li><strong>Proof of concept</strong>A script, request, or screenshot demonstrating the issue, where relevant.</li>
          <li><strong>Impact</strong>What a realistic attacker could actually do with this.</li>
          <li><strong>Your details</strong>Your full name and the test account you used.</li>
        </ol>
      </section>

      <section id="scope">
        <span class="eyebrow">Scope</span>
        <h2>What we want to hear about -- and what to avoid</h2>
        <p class="lead-para">This policy covers the following properties. Testing against anyone else's systems, including payment providers or third-party seller sites, is not covered here.</p>
        <div class="domains">
          <span>ballylife.com</span>
          <span>*.ballylife.com</span>
          <span>Ballylife mobile app</span>
        </div>
        <div class="scope-cols">
          <div class="scope-col">
            <h4><span class="dot ok"></span>Generally in scope</h4>
            <ul>
              <li>Issues reachable once a user is logged in</li>
              <li>Exposed admin panels, ports, or services</li>
              <li>Injection flaws (SQL, XXE, XSS)</li>
              <li>Remote code execution</li>
              <li>Broken access or permission controls</li>
              <li>CSRF / SSRF</li>
              <li>Privilege escalation</li>
            </ul>
          </div>
          <div class="scope-col">
            <h4><span class="dot no"></span>Please don't</h4>
            <ul>
              <li>Access or alter another user's account or data</li>
              <li>Run denial-of-service tests, or degrade the service</li>
              <li>Upload malicious files to our systems</li>
              <li>Send phishing, spam, or spoofed messages</li>
              <li>Test third-party or seller-operated pages</li>
              <li>Go further than what's needed to prove the issue</li>
            </ul>
          </div>
        </div>
        <p class="note">If you believe you can access another person's account or data, stop and email us first -- we'll agree next steps with you before any further testing happens. Testing outside this scope may lead us to suspend your access and, where warranted, involve the relevant authorities.</p>
      </section>

      <section id="severity">
        <span class="eyebrow">How we triage</span>
        <h2>Severity ratings and response targets</h2>
        <p class="lead-para">Once a report comes in, we classify it by real-world impact. These targets are what we aim for, not a guarantee -- complex issues can take longer to fully resolve.</p>
        <div class="sev-table">
          <div class="sev-row head"><span>Severity</span><span>What it typically means</span><span>Target response</span></div>
          <div class="sev-row">
            <span class="sev-pill critical">Critical</span>
            <span class="desc">Full account takeover, remote code execution, or exposure of many users' data</span>
            <span class="sla">&lt; 24 hours</span>
          </div>
          <div class="sev-row">
            <span class="sev-pill high">High</span>
            <span class="desc">Significant data exposure or privilege escalation limited in scope</span>
            <span class="sla">&lt; 3 business days</span>
          </div>
          <div class="sev-row">
            <span class="sev-pill medium">Medium</span>
            <span class="desc">Limited impact requiring specific conditions or user interaction</span>
            <span class="sla">&lt; 10 business days</span>
          </div>
          <div class="sev-row">
            <span class="sev-pill low">Low</span>
            <span class="desc">Minimal, hard-to-exploit issues with negligible real-world impact</span>
            <span class="sla">Reviewed, fixed as capacity allows</span>
          </div>
        </div>
      </section>

      <section id="non-qualifying">
        <span class="eyebrow">Non-qualifying submissions</span>
        <h2>What generally doesn't qualify</h2>
        <p class="lead-para">Whether something counts as a valid finding depends on its real-world impact. The following are usually excluded unless you can show a genuine, exploitable attack path built on top of them.</p>
        <div class="tagcloud">
          <span>Verbose error messages</span>
          <span>robots.txt / known public files</span>
          <span>Clickjacking (no sensitive action)</span>
          <span>Self-XSS</span>
          <span>CAPTCHA bypass reports</span>
          <span>Username enumeration</span>
          <span>OPTIONS/TRACE enabled</span>
          <span>TLS/SSL configuration</span>
          <span>Missing security headers</span>
          <span>Automated scanner output</span>
          <span>Third-party app issues</span>
          <span>Already publicly known issues</span>
        </div>
        <p class="note">We review borderline submissions case by case, and this list may change over time as our platform does.</p>
      </section>

      <section id="commitment">
        <span class="eyebrow">Our commitment</span>
        <h2>What happens after you report</h2>
        <p class="lead-para">A responsible disclosure only works if it goes both ways. Here's the path every valid, in-scope report follows.</p>
        <div class="timeline">
          <div class="tl-item">
            <span class="when">Step 1</span>
            <h4>Acknowledge</h4>
            <p>We confirm receipt of your report and open a case for it.</p>
          </div>
          <div class="tl-item">
            <span class="when">Step 2</span>
            <h4>Validate</h4>
            <p>We reproduce the issue internally and assign it a severity rating.</p>
          </div>
          <div class="tl-item">
            <span class="when">Step 3</span>
            <h4>Fix</h4>
            <p>We work to resolve confirmed vulnerabilities within the target for their severity tier.</p>
          </div>
          <div class="tl-item">
            <span class="when">Step 4</span>
            <h4>Recognise</h4>
            <p>Once resolved, we follow up to confirm the fix and close out recognition for your report.</p>
          </div>
        </div>
        <div class="recognition-box">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="9" r="5" stroke="#B0873F" stroke-width="1.6"/><path d="M8.5 13.5L7 21l5-2.5L17 21l-1.5-7.5" stroke="#B0873F" stroke-width="1.6" stroke-linejoin="round"/></svg>
          <p>Ballylife doesn't run a paid bug bounty program, so no monetary reward is offered. The first person to responsibly report a previously unknown, qualifying issue receives a certificate of appreciation in their name.</p>
        </div>
      </section>

      <section id="faq">
        <span class="eyebrow">Frequently asked</span>
        <h2>A few common questions</h2>
        <div class="faq-item">
          <h4>Do I need permission before I start testing?</h4>
          <p>No -- you can test against your own account or a disclosed test account at any time, as long as you stay within the scope and ground rules above.</p>
        </div>
        <div class="faq-item">
          <h4>What if my finding touches another customer's data?</h4>
          <p>Stop immediately and email us before doing anything further. We'll work with you directly on safe next steps rather than have you continue on your own.</p>
        </div>
        <div class="faq-item">
          <h4>Can I publish my findings once it's fixed?</h4>
          <p>Once we've confirmed a fix, reach out to us first -- we're generally happy to see write-ups, and we'd like the chance to coordinate timing with you.</p>
        </div>
        <div class="faq-item">
          <h4>Will I get paid for a valid report?</h4>
          <p>Not currently. Ballylife recognises valid, first-reported findings with a certificate of appreciation rather than a cash bounty.</p>
        </div>
      </section>

    </main>
  </div>

  <div class="page">
    <footer>
      <div class="brand">Ballylife</div>
      <p>This policy may be updated from time to time as our platform and processes evolve.</p>
    </footer>
  </div>

  <script>
    // Highlight the active section in the sidebar and top nav as the reader scrolls.
    var sections = document.querySelectorAll('main section[id]');
    var railLinks = document.querySelectorAll('.rail a');
    var topLinks = document.querySelectorAll('#topnav a');

    function setActive(id){
      railLinks.forEach(function(a){ a.classList.toggle('active', a.getAttribute('href') === '#' + id); });
      topLinks.forEach(function(a){ a.classList.toggle('active', a.getAttribute('href') === '#' + id); });
    }

    if ('IntersectionObserver' in window){
      var observer = new IntersectionObserver(function(entries){
        entries.forEach(function(entry){
          if (entry.isIntersecting) setActive(entry.target.id);
        });
      }, { rootMargin: '-40% 0px -50% 0px', threshold: 0 });
      sections.forEach(function(s){ observer.observe(s); });
    }
  </script>

</body>
</html>`;

export function DisclosurePage({ onBack }: { onBack: () => void }) {
  return <PolicyPageFrame title="Ballylife Responsible Disclosure Policy" srcDoc={DISCLOSURE_PAGE_HTML} onBack={onBack} />;
}
