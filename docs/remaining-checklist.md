# Remaining Checklist

Every item here traces back to something actually found and documented
during Phases 0–6 — nothing new is being introduced in this list, it's a
consolidation. Ordered by priority, not by which phase found it.

## Do first (real risk, not just polish)

- [ ] **Enable database backups.** Verified directly against Railway's
      live config: currently zero backup protection exists. 5 minutes,
      no downtime. Steps: `docs/production-readiness.md`. This is the
      single highest-priority item on this entire list — everything
      else is recoverable from a mistake; an unbacked-up production
      database is not.
- [ ] **Set PayFast merchant credentials** if this is meant to take real
      payments. The integration is code-complete and tested
      (`payfastProcessor.ts` — real signature verification, real
      webhook handling, real refunds); it's inactive because
      `PAYFAST_MERCHANT_ID`/`PAYFAST_MERCHANT_KEY`/`PAYFAST_PASSPHRASE`/
      `PAYFAST_MODE`/`MARKETPLACE_PUBLIC_URL`/`MARKETPLACE_API_PUBLIC_URL`
      are all unset. Every order right now silently falls back to the
      `manual` placeholder processor. See `server/.env.example`.
- [ ] **Decide what to do with VINK-GRUP-LIMITED's leftover marketplace
      tables** (`mkt_categories`, `mkt_sellers`, `mkt_products`, etc. in
      that other repo's schema) — inert, but a real decision about
      whether there's live data worth migrating before anyone drops
      them. See README's "Known leftover" section.

## Do soon (real gaps, lower urgency)

- [ ] **Set Google/Facebook OAuth credentials** if social sign-in
      matters for conversion. Same situation as PayFast — fully built
      (`authRouter.ts`'s `/google` and `/facebook` routes, real token
      verification against each provider's own servers), inactive
      until `GOOGLE_CLIENT_ID`/`FACEBOOK_APP_ID` exist. `GET
      /api/auth/oauth-config` shows current status.
- [ ] **Run the load test script against a real environment** —
      `server/scripts/loadtest.mjs` exists and its logic is validated,
      but was never run against production (no Docker locally to test
      against a local stack either, in the environment this was built
      in). Run it — locally via `docker compose up` first, then against
      production with explicit awareness of the cost/risk — before
      trusting this app's actual capacity under load.
- [ ] **Decide the token_version behavior for role changes** before
      building a role-change admin UI. `GET /admin/users` exists
      (Phase 5) but is deliberately view-only: should promoting/
      demoting a user force their current session to re-authenticate
      immediately (bump `token_version`), or let it finish at the old
      role until it naturally expires? This is a real product decision,
      not an implementation detail.
- [ ] **Add a real APM/observability tool** (Sentry, Datadog,
      OpenTelemetry, or similar) once you've picked one — Railway
      captures console output today, but there's no metrics/tracing/
      alerting. The structured logger (`utils/logger.ts`) added in
      Phase 6 is ready to feed one; only applied to the PayFast webhook
      handler so far, not the rest of the codebase.

## Worth knowing about, not urgent

- [ ] **`bank_transfer` and `wallet` payment methods stay manual**
      even once PayFast credentials are set — only `payfast`/`card`
      route through the real processor. Add a second `MktPayProcessor`
      if you want those automated too (same interface PayFast
      implements).
- [ ] **A formal disputes system** doesn't exist beyond the existing
      refund/return flow (`POST /admin/orders/:id/refund`,
      `POST /orders/:id/request-return`). Whether a dedicated dispute-
      tracking flow (distinct states, evidence upload, a resolution
      queue) is worth building depends on actual return/complaint
      volume — not something to build speculatively.
- [ ] **The audit log's append-only guarantee is by application
      convention, not a database constraint.** `mkt_audit_log` rows are
      only ever `INSERT`ed by this codebase's own routes today; nothing
      stops a direct database `UPDATE`/`DELETE` (e.g. by a compromised
      admin credential with DB access) from tampering with it. A
      database-level trigger enforcing true immutability is the
      stronger version of this, not yet built.
- [ ] **A reconciliation job** (checking that confirmed payment amounts,
      order totals, and settlement line totals always agree) is
      designed in `docs/migration-plan.md` item 4 but needs a job-
      runner or Railway cron service this project doesn't have yet —
      correctly deferred rather than built without that infrastructure.
- [ ] **No Terraform/IaC** — deliberately not adopted (no official
      Railway provider exists; Railway's own native IaC is explicitly
      experimental). Revisit if Railway's own tool matures, or if team
      size grows enough that manual dashboard config becomes a real
      bottleneck.

## Already resolved during this engagement (listed so they're not
## re-investigated from scratch by whoever reads this next)

- JWT secret now fails closed in production rather than falling back to
  an insecure default (Phase 1).
- Token revocation exists and is tested (Phase 3) — a password change
  invalidates every other session immediately.
- Every seller/supplier/shipping-company/credit-provider/revenue-
  authority route was verified (not assumed) to check record ownership,
  not just role (Phase 2/3).
- The PayFast IP-allowlist question was researched and deliberately
  **not** implemented — a hardcoded list was found to be an active risk
  (PayFast's IPs changed with a 2025 AWS migration; a real-world case
  exists of a stale list silently rejecting legitimate payments
  elsewhere). The existing two-layer verification (signature +
  server-to-server confirm) doesn't have that failure mode.
