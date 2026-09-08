import { PolicyPageFrame } from "./PolicyPageFrame";

// The contact page was supplied as a complete, self-contained HTML/CSS/JS
// block (its own <style> and <script>, scoped under .bl-contact). Rendering
// it via an iframe's srcDoc -- rather than dangerouslySetInnerHTML -- is a
// deliberate choice: React never executes <script> tags injected through
// dangerouslySetInnerHTML, so the country-office modal and the form's
// submit handler simply wouldn't run any other way. The iframe also keeps
// this page's own CSS fully isolated from the rest of the app, which the
// original block was already designed for (all classes prefixed "bl-").
const CONTACT_PAGE_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Contact Ballylife</title>
</head>
<body style="margin:0;">
<section class="bl-contact">
  <style>
    .bl-contact{
      --bl-green-dark:#0f3d2e;
      --bl-green-darker:#0b2f24;
      --bl-green:#146c43;
      --bl-orange:#f5821f;
      --bl-orange-dark:#e06f10;
      --bl-cream:#ffffff;
      --bl-bg:#fbfbf9;
      --bl-text:#1c2b26;
      --bl-muted:#5b6b65;
      --bl-border:#e7e5df;
      font-family:'Segoe UI', Arial, sans-serif;
      color:var(--bl-text);
      background:var(--bl-bg);
      line-height:1.5;
    }
    .bl-contact *{box-sizing:border-box;}
    .bl-contact a{color:inherit; text-decoration:none;}
    .bl-contact ul{list-style:none; margin:0; padding:0;}
    .bl-contact button{font-family:inherit; cursor:pointer;}
    .bl-wrap{max-width:1440px; margin:0 auto; padding:0 60px;}
    .bl-hero{
      position:relative;
      background:
        linear-gradient(100deg, rgba(11,30,26,.82) 0%, rgba(11,30,26,.55) 40%, rgba(11,30,26,.15) 75%),
        url('https://images.unsplash.com/photo-1580746738099-1a9e6a5d0b0e?auto=format&fit=crop&w=1600&q=60') center/cover;
      background-color:#123b2e;
      padding:70px 0 90px;
      overflow:hidden;
      color:#fff;
    }
    .bl-hero-inner{position:relative; z-index:2; max-width:640px;}
    .bl-eyebrow{
      display:flex; align-items:center; gap:10px;
      color:var(--bl-orange); font-weight:700; letter-spacing:.5px;
      margin-bottom:18px; font-size:14px;
    }
    .bl-eyebrow::before{content:""; width:28px; height:2px; background:var(--bl-orange); display:inline-block;}
    .bl-hero h1{
      font-size:56px; margin:0 0 18px; font-weight:800; color:#fff; line-height:1.05;
    }
    .bl-hero h1 span{color:var(--bl-orange);}
    .bl-hero p{font-size:16px; color:#eef3f0; max-width:520px; margin:0;}
    .bl-hero-tag{
      position:absolute; right:270px; top:70px; z-index:2; color:#fff;
      font-family:Georgia, 'Times New Roman', serif; font-style:italic;
      font-size:22px; line-height:1.35; text-align:right; max-width:220px;
    }
    .bl-h2{font-size:28px; font-weight:800; margin:0 0 26px; color:var(--bl-green-darker);}
    .bl-h2 span{color:var(--bl-orange);}
    .bl-main{padding:56px 0; }
    .bl-grid{display:grid; grid-template-columns:0.85fr 2.3fr; gap:34px; align-items:start;}
    .bl-info-col{position:relative; padding-left:26px;}
    .bl-info-col::before{
      content:""; position:absolute; left:0; top:0; bottom:0; width:4px;
      background:linear-gradient(to bottom, var(--bl-orange) 0 65%, var(--bl-green) 65% 100%);
      border-radius:4px;
    }
    .bl-info-item{display:flex; gap:16px; padding:18px 0; border-bottom:1px solid var(--bl-border);}
    .bl-info-item:last-child{border-bottom:none;}
    .bl-icon-badge{
      flex:0 0 auto; width:46px; height:46px; border-radius:50%;
      background:var(--bl-green-darker); color:#fff;
      display:flex; align-items:center; justify-content:center;
    }
    .bl-info-item h4{margin:2px 0 6px; font-size:16px; color:var(--bl-green-darker);}
    .bl-info-item p{margin:0; font-size:14.5px; color:var(--bl-muted);}
    .bl-countries-head{display:flex; align-items:center; gap:10px; margin-bottom:20px;}
    .bl-countries-head svg{flex:0 0 auto;}

    /* Original bullet-list style, restored -- each of the 5 regions is
       now its own top-level column (no nesting/pairing), all starting
       flush at the top, using the full width freed up by removing the
       contact form. Every country is always shown, no expand/collapse. */
    .bl-region-columns{display:grid; grid-template-columns:repeat(5,1fr); gap:18px; align-items:start;}
    .bl-region h5{color:var(--bl-orange); font-size:14px; margin:0 0 12px; font-weight:700;}
    .bl-region ul{margin:0; padding:0; list-style:none;}
    .bl-region ul li{
      font-size:13px; color:var(--bl-text); padding:4px 0; position:relative; padding-left:14px;
    }
    .bl-region ul li::before{
      content:"\2022"; color:var(--bl-green); position:absolute; left:0; top:4px; font-size:11px;
    }
    .bl-country{
      cursor:pointer; border-radius:4px; transition:color .12s ease, padding-left .12s ease; display:block;
    }
    .bl-country:hover,
    .bl-country:focus-visible{
      color:var(--bl-orange); font-weight:600; outline:none; padding-left:18px;
    }
    .bl-country:hover::before,
    .bl-country:focus-visible::before{color:var(--bl-orange);}

    .bl-modal-overlay{
      display:none; position:fixed; inset:0; z-index:1000; background:rgba(11,30,26,.6);
      align-items:center; justify-content:center; padding:20px;
    }
    .bl-modal-overlay.bl-open{display:flex;}
    .bl-modal{
      background:#fff; border-radius:16px; max-width:460px; width:100%;
      max-height:80vh; overflow-y:auto; position:relative;
      box-shadow:0 20px 60px rgba(0,0,0,.3);
    }
    .bl-modal-head{
      background:linear-gradient(135deg, var(--bl-green-dark), var(--bl-green-darker));
      color:#fff; padding:24px 28px; border-radius:16px 16px 0 0;
      display:flex; align-items:flex-start; justify-content:space-between; gap:12px;
    }
    .bl-modal-head h3{margin:0 0 4px; font-size:20px; font-weight:800;}
    .bl-modal-head p{margin:0; font-size:13px; color:#cfe0d8;}
    .bl-modal-close{
      background:rgba(255,255,255,.15); border:none; color:#fff; width:30px; height:30px;
      border-radius:50%; display:flex; align-items:center; justify-content:center; flex:0 0 auto;
    }
    .bl-modal-close:hover{background:var(--bl-orange);}
    .bl-modal-body{padding:22px 28px 28px;}
    .bl-office{
      display:flex; gap:14px; padding:16px 0; border-bottom:1px solid var(--bl-border);
    }
    .bl-office:last-child{border-bottom:none;}
    .bl-office .bl-icon-badge{width:38px; height:38px; background:var(--bl-green-darker); flex:0 0 auto;}
    .bl-office h5{margin:0 0 4px; font-size:14.5px; color:var(--bl-green-darker);}
    .bl-office p{margin:0; font-size:13.5px; color:var(--bl-muted);}
    .bl-office p a{color:var(--bl-green); font-weight:600;}
    .bl-office-empty{font-size:13.5px; color:var(--bl-muted); line-height:1.6;}
    .bl-office-empty a{color:var(--bl-orange); font-weight:600;}
    .bl-feature-strip{
      display:grid; grid-template-columns:repeat(3,1fr); gap:24px; margin-top:40px;
      padding-top:32px; border-top:1px solid var(--bl-border);
    }
    .bl-feature{display:flex; gap:14px; align-items:flex-start;}
    .bl-feature .bl-icon-badge{width:44px; height:44px;}
    .bl-feature h5{margin:0 0 4px; font-size:15px; color:var(--bl-green-darker);}
    .bl-feature p{margin:0; font-size:13px; color:var(--bl-muted);}
    .bl-map-band{background:var(--bl-green-darker); color:#fff; padding:0;}
    .bl-map-grid{display:grid; grid-template-columns:0.85fr 1.5fr 1fr 0.85fr; align-items:stretch;}
    .bl-map-left{padding:44px 40px; display:flex; flex-direction:column; justify-content:center;}
    .bl-map-left .bl-pin{color:var(--bl-orange); margin-bottom:14px;}
    .bl-map-left h3{font-size:24px; margin:0 0 8px; font-weight:800;}
    .bl-map-left h3 span{color:var(--bl-orange);}
    .bl-map-left p{margin:0 0 20px; color:#cfe0d8; font-size:14px;}
    .bl-btn-outline{
      display:inline-flex; align-items:center; gap:8px; background:var(--bl-orange);
      color:#fff; padding:12px 22px; border-radius:24px; font-weight:700; font-size:14px; width:fit-content;
      border:none;
    }
    .bl-map-frame{min-height:260px; border:none; width:100%; height:100%; display:block; filter:saturate(.9);}
    .bl-map-photo{
      background:url('https://images.unsplash.com/photo-1590486803833-1c5dc8ddd4c8?auto=format&fit=crop&w=1200&q=60') center/cover;
      min-height:260px;
    }
    .bl-map-right{padding:36px 34px; display:flex; flex-direction:column; justify-content:center; gap:16px;}
    .bl-map-right .bl-loc-title{display:flex; gap:10px; align-items:flex-start;}
    .bl-map-right .bl-loc-title svg{color:var(--bl-orange); flex:0 0 auto; margin-top:2px;}
    .bl-map-right h4{margin:0 0 2px; font-size:16px;}
    .bl-map-right p{margin:0; font-size:13.5px; color:#cfe0d8;}
    .bl-btn-ghost{
      display:inline-flex; align-items:center; gap:8px; border:1px solid rgba(255,255,255,.5);
      color:#fff; padding:10px 18px; border-radius:22px; font-size:13.5px; font-weight:600;
      width:fit-content; background:transparent;
    }
    .bl-footer{
      background:var(--bl-green-darker); color:#dcebe4; padding:26px 0;
      border-top:2px solid var(--bl-orange);
    }
    .bl-footer-inner{display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;}
    .bl-footer-brand{display:flex; align-items:center; gap:10px; font-weight:800; font-size:17px; color:#fff;}
    .bl-footer-brand span{color:var(--bl-orange);}
    .bl-footer-brand small{display:block; font-weight:400; font-size:11px; color:#a9c2b6;}
    .bl-footer-copy{font-size:13px; color:#b7cec2;}
    .bl-social{display:flex; gap:10px;}
    .bl-social a{
      width:34px; height:34px; border-radius:50%; border:1px solid #4a6b5d;
      display:flex; align-items:center; justify-content:center; color:#fff;
      transition:background .15s ease, border-color .15s ease;
    }
    .bl-social a:hover{background:var(--bl-orange); border-color:var(--bl-orange);}
    @media (max-width:1180px){
      .bl-grid{grid-template-columns:1fr; }
      .bl-info-col{padding-left:16px;}
      .bl-region-columns{grid-template-columns:repeat(3,1fr);}
      .bl-map-grid{grid-template-columns:1fr 1fr;}
      .bl-map-photo{display:none;}
    }
    @media (max-width:760px){
      .bl-wrap{padding:0 20px;}
      .bl-hero{padding:50px 0 60px;}
      .bl-hero h1{font-size:36px;}
      .bl-hero-tag{display:none;}
      .bl-region-columns{grid-template-columns:repeat(2,1fr);}
      .bl-feature-strip{grid-template-columns:1fr;}
      .bl-map-grid{grid-template-columns:1fr;}
      .bl-footer-inner{flex-direction:column; text-align:center;}
    }
    @media (max-width:480px){
      .bl-region-columns{grid-template-columns:1fr;}
    }
  </style>

  <div class="bl-hero">
    <div class="bl-wrap">
      <div class="bl-hero-inner">
        <div class="bl-eyebrow">CONTACT US</div>
        <h1>Get In <span>Touch</span></h1>
        <p>We value your interest in Ballylife. Whether you have a question, need support, or want to partner with us, we'd love to hear from you.</p>
      </div>
      <div class="bl-hero-tag">Building a stronger Africa together</div>
    </div>
  </div>

  <div class="bl-main">
    <div class="bl-wrap">
      <div class="bl-grid">
        <div>
          <h2 class="bl-h2">Our Contact <span>Information</span></h2>
          <div class="bl-info-col">
            <div class="bl-info-item">
              <div class="bl-icon-badge">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>
              </div>
              <div>
                <h4>Head Quarters</h4>
                <p>Lusaka, Zambia</p>
              </div>
            </div>
            <div class="bl-info-item">
              <div class="bl-icon-badge">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.7a2 2 0 0 1-.5 2.1L8 9.6a16 16 0 0 0 6 6l1.1-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2z"/></svg>
              </div>
              <div>
                <h4>Phone</h4>
                <p>+260 211 123 456&nbsp; |&nbsp; +260 977 123 456</p>
              </div>
            </div>
            <div class="bl-info-item">
              <div class="bl-icon-badge">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z" opacity="0"/><path d="M3.5 6.5h17a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-17a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/><path d="M3 7l9 6 9-6"/></svg>
              </div>
              <div>
                <h4>Email</h4>
                <p>info@ballylife.com</p>
              </div>
            </div>
            <div class="bl-info-item">
              <div class="bl-icon-badge">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>
              </div>
              <div>
                <h4>Working Hours</h4>
                <p>Monday - Friday: 08:00 AM - 05:00 PM<br>Saturday: 08:00 AM - 12:00 PM</p>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div class="bl-countries-head">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="var(--bl-green)"><path d="M12 2c-4 0-6 3-6 6 0 2 1 3 1 5-2 0-3 2-3 4 0 3 3 5 6 5 2 0 2-2 4-2s2 3 5 2c2-.7 3-3 3-5 0-2-1-3-2-4 1-1 2-3 2-5 0-3-2-6-6-6z"/></svg>
            <h2 class="bl-h2" style="margin:0;">All African Countries<br><span>We Work With</span></h2>
          </div>
          <div class="bl-region-columns" id="bl-region-columns">
            <div class="bl-region" data-region="North Africa">
              <h5>North Africa</h5>
              <ul>
                <li class="bl-country" data-country="Algeria" tabindex="0" role="button">Algeria</li>
                <li class="bl-country" data-country="Egypt" tabindex="0" role="button">Egypt</li>
                <li class="bl-country" data-country="Libya" tabindex="0" role="button">Libya</li>
                <li class="bl-country" data-country="Morocco" tabindex="0" role="button">Morocco</li>
                <li class="bl-country" data-country="Sudan" tabindex="0" role="button">Sudan</li>
                <li class="bl-country" data-country="Tunisia" tabindex="0" role="button">Tunisia</li>
                <li class="bl-country" data-country="Western Sahara" tabindex="0" role="button">Western Sahara</li>
              </ul>
            </div>
            <div class="bl-region" data-region="West Africa">
              <h5>West Africa</h5>
              <ul>
                <li class="bl-country" data-country="Benin" tabindex="0" role="button">Benin</li>
                <li class="bl-country" data-country="Burkina Faso" tabindex="0" role="button">Burkina Faso</li>
                <li class="bl-country" data-country="Cabo Verde" tabindex="0" role="button">Cabo Verde</li>
                <li class="bl-country" data-country="Cote d'Ivoire" tabindex="0" role="button">Cote d'Ivoire</li>
                <li class="bl-country" data-country="Gambia" tabindex="0" role="button">Gambia</li>
                <li class="bl-country" data-country="Ghana" tabindex="0" role="button">Ghana</li>
                <li class="bl-country" data-country="Guinea" tabindex="0" role="button">Guinea</li>
                <li class="bl-country" data-country="Guinea-Bissau" tabindex="0" role="button">Guinea-Bissau</li>
                <li class="bl-country" data-country="Liberia" tabindex="0" role="button">Liberia</li>
                <li class="bl-country" data-country="Mali" tabindex="0" role="button">Mali</li>
                <li class="bl-country" data-country="Mauritania" tabindex="0" role="button">Mauritania</li>
                <li class="bl-country" data-country="Niger" tabindex="0" role="button">Niger</li>
                <li class="bl-country" data-country="Nigeria" tabindex="0" role="button">Nigeria</li>
                <li class="bl-country" data-country="Senegal" tabindex="0" role="button">Senegal</li>
                <li class="bl-country" data-country="Sierra Leone" tabindex="0" role="button">Sierra Leone</li>
                <li class="bl-country" data-country="Togo" tabindex="0" role="button">Togo</li>
              </ul>
            </div>
            <div class="bl-region" data-region="East Africa">
              <h5>East Africa</h5>
              <ul>
                <li class="bl-country" data-country="Burundi" tabindex="0" role="button">Burundi</li>
                <li class="bl-country" data-country="Djibouti" tabindex="0" role="button">Djibouti</li>
                <li class="bl-country" data-country="Eritrea" tabindex="0" role="button">Eritrea</li>
                <li class="bl-country" data-country="Ethiopia" tabindex="0" role="button">Ethiopia</li>
                <li class="bl-country" data-country="Kenya" tabindex="0" role="button">Kenya</li>
                <li class="bl-country" data-country="Rwanda" tabindex="0" role="button">Rwanda</li>
                <li class="bl-country" data-country="Somalia" tabindex="0" role="button">Somalia</li>
                <li class="bl-country" data-country="South Sudan" tabindex="0" role="button">South Sudan</li>
                <li class="bl-country" data-country="Uganda" tabindex="0" role="button">Uganda</li>
              </ul>
            </div>
            <div class="bl-region" data-region="Central Africa">
              <h5>Central Africa</h5>
              <ul>
                <li class="bl-country" data-country="Cameroon" tabindex="0" role="button">Cameroon</li>
                <li class="bl-country" data-country="Central African Republic" tabindex="0" role="button">Central African Republic</li>
                <li class="bl-country" data-country="Chad" tabindex="0" role="button">Chad</li>
                <li class="bl-country" data-country="Republic of the Congo" tabindex="0" role="button">Republic of the Congo</li>
                <li class="bl-country" data-country="Equatorial Guinea" tabindex="0" role="button">Equatorial Guinea</li>
                <li class="bl-country" data-country="Gabon" tabindex="0" role="button">Gabon</li>
                <li class="bl-country" data-country="Sao Tome and Principe" tabindex="0" role="button">Sao Tome and Principe</li>
              </ul>
            </div>
            <div class="bl-region" data-region="Southern Africa (SADC)">
              <h5>Southern Africa (SADC)</h5>
              <ul>
                <li class="bl-country" data-country="Angola" tabindex="0" role="button">Angola</li>
                <li class="bl-country" data-country="Botswana" tabindex="0" role="button">Botswana</li>
                <li class="bl-country" data-country="Comoros" tabindex="0" role="button">Comoros</li>
                <li class="bl-country" data-country="Democratic Republic of the Congo" tabindex="0" role="button">Democratic Republic of the Congo</li>
                <li class="bl-country" data-country="Eswatini (Swaziland)" tabindex="0" role="button">Eswatini (Swaziland)</li>
                <li class="bl-country" data-country="Lesotho" tabindex="0" role="button">Lesotho</li>
                <li class="bl-country" data-country="Madagascar" tabindex="0" role="button">Madagascar</li>
                <li class="bl-country" data-country="Malawi" tabindex="0" role="button">Malawi</li>
                <li class="bl-country" data-country="Mauritius" tabindex="0" role="button">Mauritius</li>
                <li class="bl-country" data-country="Mozambique" tabindex="0" role="button">Mozambique</li>
                <li class="bl-country" data-country="Namibia" tabindex="0" role="button">Namibia</li>
                <li class="bl-country" data-country="Seychelles" tabindex="0" role="button">Seychelles</li>
                <li class="bl-country" data-country="South Africa" tabindex="0" role="button">South Africa</li>
                <li class="bl-country" data-country="Tanzania" tabindex="0" role="button">Tanzania</li>
                <li class="bl-country" data-country="Zambia" tabindex="0" role="button">Zambia</li>
                <li class="bl-country" data-country="Zimbabwe" tabindex="0" role="button">Zimbabwe</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div class="bl-feature-strip">
        <div class="bl-feature">
          <div class="bl-icon-badge" style="background:var(--bl-orange);">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M8 13V6a2 2 0 0 1 4 0"/><path d="M12 13V4a2 2 0 0 1 4 0v9"/><path d="M16 12V6a2 2 0 0 1 4 0v9c0 3.3-2.7 6-6 6h-2c-2.2 0-3.6-.7-5-2l-3-3 1.4-1.4a2 2 0 0 1 2.6-.2L8 14"/></svg>
          </div>
          <div>
            <h5>Partnerships</h5>
            <p>We welcome collaborations and strategic partnerships.</p>
          </div>
        </div>
        <div class="bl-feature">
          <div class="bl-icon-badge">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M12 3C7 4 4 7 4 12c0 3.5 2 6 5 7 0-3 1-6 3-8 2 2 3 5 3 8 3-1 5-3.5 5-7 0-5-3-8-8-9z"/></svg>
          </div>
          <div>
            <h5>Support</h5>
            <p>Our team is ready to assist you with any inquiries.</p>
          </div>
        </div>
        <div class="bl-feature">
          <div class="bl-icon-badge" style="background:var(--bl-orange);">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3 2.5-5 6-5s6 2 6 5"/><path d="M15 20c0-2 1.5-4 4-4s4 1.7 4 4"/></svg>
          </div>
          <div>
            <h5>Together</h5>
            <p>Let's build a stronger, brighter future for Africa.</p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="bl-map-band">
    <div class="bl-map-grid">
      <div class="bl-map-left">
        <div class="bl-pin">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c-4 0-7 3-7 7 0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z"/></svg>
        </div>
        <h3>Find Us on the <span>Map</span></h3>
        <p>Visit our headquarters in Lusaka, Zambia.</p>
        <a class="bl-btn-outline" href="https://www.google.com/maps/place/Lusaka,+Zambia" target="_blank" rel="noopener">
          Get Directions
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </a>
      </div>
      <iframe class="bl-map-frame" loading="lazy" allowfullscreen
        src="https://www.google.com/maps?q=Lusaka,Zambia&output=embed"></iframe>
      <div class="bl-map-photo" role="img" aria-label="Aerial view of Lusaka city skyline"></div>
      <div class="bl-map-right">
        <div class="bl-loc-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c-4 0-7 3-7 7 0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z"/></svg>
          <div>
            <h4>Ballylife Headquarters</h4>
            <p>Lusaka, Zambia</p>
          </div>
        </div>
        <a class="bl-btn-ghost" href="https://www.google.com/maps/place/Lusaka,+Zambia" target="_blank" rel="noopener">
          View Location
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </a>
      </div>
    </div>
  </div>

  <div class="bl-footer">
    <div class="bl-wrap bl-footer-inner">
      <div class="bl-footer-brand">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="var(--bl-orange)"><path d="M12 2c-4 0-6 3-6 6 0 2 1 3 1 5-2 0-3 2-3 4 0 3 3 5 6 5 2 0 2-2 4-2s2 3 5 2c2-.7 3-3 3-5 0-2-1-3-2-4 1-1 2-3 2-5 0-3-2-6-6-6z"/></svg>
        <div>
          Bally<span>life</span>
          <small>Together for a brighter future</small>
        </div>
      </div>
      <div class="bl-footer-copy">(c) 2025 Ballylife. All rights reserved.</div>
      <div class="bl-social">
        <a href="#" aria-label="Facebook"><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M13 22v-8h3l1-4h-4V7c0-1.1.3-2 2-2h2V1.2C16.6 1 15.3 1 14 1c-3 0-5 1.8-5 5v3H6v4h3v8h4z"/></svg></a>
        <a href="#" aria-label="X"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 2h4.5l4 5.5L16 2h5l-7 8.7L21.5 22H17l-4.4-6-5 6H3l7.4-9L3 2z"/></svg></a>
        <a href="#" aria-label="LinkedIn"><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M4.98 3.5A2.5 2.5 0 1 1 5 8.5a2.5 2.5 0 0 1-.02-5zM3 9h4v12H3zM9 9h3.8v1.7h.05c.53-1 1.83-2 3.77-2 4.03 0 4.78 2.65 4.78 6.1V21H17v-5.6c0-1.34-.02-3.05-1.86-3.05-1.87 0-2.16 1.46-2.16 2.96V21H9z"/></svg></a>
        <a href="#" aria-label="YouTube"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M23 7.5s-.2-1.6-.9-2.3c-.9-.9-1.9-.9-2.3-1C16.9 4 12 4 12 4s-4.9 0-7.8.2c-.4 0-1.4.1-2.3 1C1.2 5.9 1 7.5 1 7.5S.8 9.4.8 11.3v1.4C.8 14.6 1 16.5 1 16.5s.2 1.6.9 2.3c.9.9 2.1.9 2.6 1 1.9.2 8 .2 8 .2s4.9 0 7.8-.2c.4 0 1.4-.1 2.3-1 .7-.7.9-2.3.9-2.3s.2-1.9.2-3.8v-1.4c0-1.9-.2-3.8-.2-3.8zM9.8 15.1V8.9l6 3.1-6 3.1z"/></svg></a>
      </div>
    </div>
  </div>

  <div class="bl-modal-overlay" id="bl-modal-overlay">
    <div class="bl-modal" role="dialog" aria-modal="true" aria-labelledby="bl-modal-title">
      <div class="bl-modal-head">
        <div>
          <h3 id="bl-modal-title">Country</h3>
          <p id="bl-modal-sub">Ballylife offices</p>
        </div>
        <button class="bl-modal-close" id="bl-modal-close" aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M5 5l14 14M19 5 5 19"/></svg>
        </button>
      </div>
      <div class="bl-modal-body" id="bl-modal-body">
      </div>
    </div>
  </div>

  <script>
    (function(){
      var OFFICES = {
        "Zambia": [
          { label:"Head Office", address:"Plot 12, Cairo Road, Lusaka, Zambia", phone:"+260 211 123 456", email:"info@ballylife.com" }
        ],
        "South Africa": [
          { label:"Johannesburg Office", address:"14 Rivonia Road, Sandton, Johannesburg, South Africa", phone:"+27 11 234 5678", email:"southafrica@ballylife.com" }
        ],
        "Kenya": [
          { label:"Nairobi Office", address:"Westlands Business Park, Nairobi, Kenya", phone:"+254 20 123 4567", email:"kenya@ballylife.com" }
        ],
        "Nigeria": [
          { label:"Lagos Office", address:"12 Adeola Odeku Street, Victoria Island, Lagos, Nigeria", phone:"+234 1 234 5678", email:"nigeria@ballylife.com" }
        ],
        "Ghana": [
          { label:"Accra Office", address:"Ring Road Central, Accra, Ghana", phone:"+233 30 123 4567", email:"ghana@ballylife.com" }
        ],
        "Egypt": [
          { label:"Cairo Office", address:"Nile Corniche, Cairo, Egypt", phone:"+20 2 1234 5678", email:"egypt@ballylife.com" }
        ]
      };

      var overlay   = document.getElementById('bl-modal-overlay');
      var titleEl   = document.getElementById('bl-modal-title');
      var subEl     = document.getElementById('bl-modal-sub');
      var bodyEl    = document.getElementById('bl-modal-body');
      var closeBtn  = document.getElementById('bl-modal-close');
      var lastFocused = null;

      function iconSvg(){
        return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
          + '<path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>';
      }

      function renderOffices(country){
        var offices = OFFICES[country];
        titleEl.textContent = country;

        if (offices && offices.length){
          subEl.textContent = offices.length + (offices.length === 1 ? ' office' : ' offices') + ' in ' + country;
          bodyEl.innerHTML = offices.map(function(o){
            return '' +
              '<div class="bl-office">' +
                '<div class="bl-icon-badge">' + iconSvg() + '</div>' +
                '<div>' +
                  '<h5>' + o.label + '</h5>' +
                  '<p>' + o.address + '</p>' +
                  (o.phone ? '<p>' + o.phone + '</p>' : '') +
                  (o.email ? '<p><a href="mailto:' + o.email + '">' + o.email + '</a></p>' : '') +
                '</div>' +
              '</div>';
          }).join('');
        } else {
          subEl.textContent = 'No dedicated office yet';
          bodyEl.innerHTML =
            '<p class="bl-office-empty">' +
              'We do not have a dedicated Ballylife office in <strong>' + country + '</strong> yet, ' +
              'but we work with partners across the region. Reach our head office in Lusaka, Zambia, ' +
              'and our team will connect you with the right contact for ' + country + ':' +
            '</p>' +
            '<div class="bl-office" style="border-top:1px solid var(--bl-border); margin-top:14px;">' +
              '<div class="bl-icon-badge">' + iconSvg() + '</div>' +
              '<div>' +
                '<h5>Head Office - Lusaka, Zambia</h5>' +
                '<p>Plot 12, Cairo Road, Lusaka, Zambia</p>' +
                '<p>+260 211 123 456</p>' +
                '<p><a href="mailto:info@ballylife.com">info@ballylife.com</a></p>' +
              '</div>' +
            '</div>';
        }
      }

      function openModal(country){
        lastFocused = document.activeElement;
        renderOffices(country);
        overlay.classList.add('bl-open');
        closeBtn.focus();
        document.addEventListener('keydown', onKeydown);
      }

      function closeModal(){
        overlay.classList.remove('bl-open');
        document.removeEventListener('keydown', onKeydown);
        if (lastFocused) lastFocused.focus();
      }

      function onKeydown(e){
        if (e.key === 'Escape') closeModal();
      }

      document.querySelectorAll('.bl-country').forEach(function(li){
        li.addEventListener('click', function(){
          openModal(li.getAttribute('data-country'));
        });
        li.addEventListener('keydown', function(e){
          if (e.key === 'Enter' || e.key === ' '){
            e.preventDefault();
            openModal(li.getAttribute('data-country'));
          }
        });
      });

      closeBtn.addEventListener('click', closeModal);
      overlay.addEventListener('click', function(e){
        if (e.target === overlay) closeModal();
      });
    })();
  </script>
</section>
</body>
</html>`;

export function ContactPage({ onBack }: { onBack: () => void }) {
  return <PolicyPageFrame title="Contact Ballylife" srcDoc={CONTACT_PAGE_HTML} onBack={onBack} />;
}
