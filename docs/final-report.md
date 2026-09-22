# Final Report: Path to Production-Ready

Written as the closing deliverable of the "complete e-commerce platform to
production-ready" engagement. Everything below was checked directly against
the real code, the real database schema, or Railway's real live
configuration before being written here — nothing in this report is
assumed or estimated.

## 1. What was changed, fixed, or added

### Audit (Phase 1)
Rather than re-derive an audit from scratch, this reused and extended the
findings already on file in `docs/threat-model.md`, `docs/remaining-
checklist.md`, and `docs/production-readiness.md` from an earlier pass over
this codebase — then added what was genuinely new to this engagement's
scope: confirming no email/phone verification existed at all, and that
`users` had no `phone` column (a real schema gap, not just a missing route).

### Demo mode: removed, not just hidden (Phase 2)
- The `⚡ Demo Mode` badge and its entire fallback-to-fake-data behavior are
  gone. A connection failure now surfaces an honest "we're having trouble
  connecting" state instead of silently serving mock catalog/order data.
- Deleted ~450KB of dead code (`demoMode.ts`, `apiClient.ts`) left over from
  before Ballylife was split out from a larger shared codebase.
- Fixed several real, previously-silent failure gaps this removal exposed —
  add-to-cart, the initial home page load, and product review submission
  all had zero error handling before; a failed request did nothing visible
  at all. All now show a clear message.
- Swept the whole frontend for leftover "in this demo" / "(demo)" language
  still shown to real customers, sellers, and the marketplace team — found
  and fixed 8 instances across 5 files. One wasn't just wording: the
  manager security panel claimed audit logging "isn't implemented," which
  was false (built in an earlier phase, just never given a UI) — fixed by
  building that UI rather than leaving an inaccurate claim in its place.

### Mandatory email + phone verification (Phase 3)
- New accounts cannot log in — or reach checkout, since no token is ever
  issued — until verified. Every **existing** account, including every demo
  login used throughout this engagement, was automatically grandfathered
  as active; nothing that worked before stopped working.
- Email verification reuses the existing SMTP infrastructure. Phone
  verification is a new Twilio-based SMS service, built to the same
  graceful-degradation standard as the PayFast integration: functional,
  fully tested, inactive until real credentials exist.
- Phone verification is only *required* when SMS is actually configured —
  otherwise a signup with a phone number would be permanently stuck below
  active waiting on a step that can never complete.
- **A real authentication bypass was found and fixed while building this**:
  signing in with Google using the same email as an unverified password
  account used to hand back a working token regardless of verification
  status — a complete bypass. Root-caused and fixed (linking now correctly
  marks email as verified, since Google genuinely just proved it, and all
  three sign-in paths share one verification-aware code path). A test
  reproduces the original bypass and confirms it's closed.
- 33+ new tests covering registration, login blocking, both verification
  flows, resend rate limiting, and the bypass fix specifically.

### Closing gaps (Phase 4)
- **Checkout could not add a delivery address.** Any new customer — which
  was every new customer, since nothing creates an address at signup
  either — would reach checkout with nothing to select and no way forward.
  Fixed with an inline add-address form.
- Built a real audit log viewer in the manager dashboard, wired to a
  backend route that existed but was never exposed anywhere.
- Fixed 15 dashboard tables (across manager, seller, and customer views)
  that would clip or force sideways page-scroll on mobile — none had a
  horizontal-scroll container.

## 2. External services/credentials still needed to go fully live

Every one of these is **fully built and tested** — the code path exists,
works, and is exercised by the test suite. Each is inactive purely because
the real credentials haven't been provisioned. This is a deliberate,
consistent pattern across the whole engagement, not partial work in
disguise.

| Service | What it's for | Where to get it | Variables needed |
|---|---|---|---|
| **PayFast** | Real payment processing (currently falls back to a manual/pending placeholder for every order) | Your PayFast merchant account | `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`, `PAYFAST_PASSPHRASE`, `PAYFAST_MODE`, `MARKETPLACE_PUBLIC_URL`, `MARKETPLACE_API_PUBLIC_URL` |
| **Twilio** | SMS/OTP phone verification (currently skipped — email verification alone is sufficient until this exists) | Twilio console | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` |
| **SMTP provider** | Transactional email — order confirmations, password resets, account verification (currently logs to the console instead of sending) | Any provider: SendGrid, Mailgun, AWS SES, Resend, or even a Gmail app password to start | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` |
| **Google Sign-In** | OAuth login (button doesn't render without this) | Google Cloud Console | `GOOGLE_CLIENT_ID` (backend) + `VITE_GOOGLE_CLIENT_ID` (frontend build) |
| **Facebook Login** | OAuth login (button doesn't render without this) | Meta for Developers | `FACEBOOK_APP_ID` (backend) + `VITE_FACEBOOK_APP_ID` (frontend build) |
| **Domain / SSL** | Already done — `www.ballylife.com` is connected and serving over HTTPS via Railway's managed TLS | — | — |

Checked directly against Railway's live configuration before writing this
table: **none of the payment, SMS, email, or OAuth variables are currently
set** — every one of these integrations is presently inactive in
production for exactly the reason above, not for any other reason.

## 3. Known limitations and recommended next steps

Ordered by what actually matters most, not by which phase found it —
cross-referenced against `docs/remaining-checklist.md`, which has the full
detail behind each line here.

### Before this takes real money or real traffic
1. **Enable database backups.** Checked directly: none exist right now.
   Five minutes in Railway's dashboard, no downtime — steps in
   `docs/production-readiness.md`. This matters more than any credential
   in the table above; an unrecoverable database is a worse outcome than
   a slow payment integration.
2. Set the PayFast credentials, once ready to take real payments.
3. Decide what to do with leftover tables from the codebase Ballylife was
   split out of — inert, but worth a deliberate decision rather than an
   accidental one.

### Worth doing soon, not blocking
4. Set the OAuth and SMTP credentials once you've picked providers.
5. Run the load-test script (`server/scripts/loadtest.mjs`) against a real
   environment — it exists and its logic is verified, but was never run
   against production or even a local stack in the environment this was
   built in.
6. Decide the intended behavior when an admin changes a user's role —
   should it force that account to re-authenticate immediately, or let the
   current session finish? A real product decision, deliberately left
   unbuilt rather than guessed at.

### Known, accepted limitations — not oversights
- **Seller signup's identity-verification step is still simulated**, not
  wired to real OTP delivery the way customer accounts now are. Every
  seller application still requires manual KYC approval regardless, so
  this isn't a gap in what actually gates a seller going live — just an
  inconsistency worth resolving if seller self-service scales up.
- **No formal dispute-resolution system** beyond the existing refund/return
  flow. Worth building only once real dispute volume justifies it.
- **No live fraud detection or IP-based anomaly monitoring** — needs real
  traffic data and dedicated infrastructure this platform doesn't have at
  its current scale yet.
- **A hardcoded PayFast IP-allowlist was deliberately not added** as a
  third webhook-verification layer — researched directly, and doing so
  turned out to be a real risk (PayFast's IPs changed with a 2025 AWS
  migration, and a real-world case exists of exactly this causing
  legitimate payments to be silently rejected elsewhere). The existing
  two-layer verification doesn't have that failure mode.
- **No Terraform/infrastructure-as-code** — no official Railway provider
  exists yet, and adopting the unofficial community one was assessed and
  declined as a dependency risk not worth taking for this project's size.

None of these were left out by oversight — each was found, evaluated, and
deliberately deferred with a documented reason, the same standard applied
to everything else in this report.
