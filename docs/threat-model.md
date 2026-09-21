# Threat Model (STRIDE)

Mapped against the real system as of Phase 1. Each row cites the actual file
where a mitigation lives, or states plainly that none exists yet — nothing
here is aspirational.

## Spoofing (is this request really from who it claims to be?)

| Threat | Mitigation | Status |
|---|---|---|
| Forged JWT | HMAC-signed, `MARKETPLACE_JWT_SECRET` (`middleware/auth.ts`) | **Mitigated.** Fails closed in production since Phase 1 (throws at boot if secret missing — see `docs/architecture.md`). |
| Forged PayFast webhook | Two-layer: signature check (`payfastProcessor.ts: verifyItnSignature`) + server-to-server `confirmWithPayfast` round-trip against PayFast's own servers | **Mitigated, and deliberately left at two layers.** A third IP-based layer was researched in Phase 3 and specifically *not* added — PayFast's IPs changed with their 2025 AWS migration and have drifted since, with a documented real-world case of a hardcoded list silently rejecting legitimate payments elsewhere. See `docs/migration-plan.md` item 2. |
| Forged Google/Facebook identity | Google: real JWKS signature verification via `google-auth-library`. Facebook: token validated by calling Facebook's own Graph API, not trusted client-side | **Mitigated.** Neither route trusts a client-supplied payload without an external round-trip. |
| Impersonating another user via `:userId` path params | `requireSelf` middleware on cart/wishlist/address routes | **Mitigated** for those routes. **Gap**: `requireSelf`'s presence was verified for cart (Phase 0 grep); not individually re-verified here for every `:userId` route in `customers`, `sellers/by-user`, etc. — worth an explicit pass. |

## Tampering (can a request or stored data be modified in transit or at rest without detection?)

| Threat | Mitigation | Status |
|---|---|---|
| MITM on API traffic | HTTPS enforced by Railway's edge; `helmet()` sets standard security headers | **Mitigated** in transit. |
| SQL injection | Every query found during Phase 0/1 uses parameterized `$1, $2...` placeholders, not string interpolation | **Mitigated** — no raw string-concatenated SQL observed in the files read. Not exhaustively re-audited line-by-line across all 6,460 lines in this phase. |
| Tampering with `mkt_order_line_settlements` payout status | Standard `UPDATE` via admin-role-gated route, no row-level audit trail beyond `*_paid_at`/`*_payout_reference` on the row itself | **Gap** — see `docs/erd.md`'s ledger-design section. No append-only log; a mistaken status flip overwrites the previous state with no record of the change. |
| Tampering with price at checkout | `POST /orders` reads price server-side from `mkt_carts`/`mkt_products`, never trusts a client-supplied amount | **Mitigated**, per the request body shape confirmed in `docs/openapi.yaml` (`{ addressId?, paymentMethod }` — no price field exists to tamper with). |

## Repudiation (can an actor deny having done something?)

| Threat | Mitigation | Status |
|---|---|---|
| Admin denies issuing a refund | `mkt_order_refunds.initiated_by` records the admin user id | **Partially mitigated** — records *who*, not a full before/after snapshot. |
| Seller/supplier denies a payout status change | `seller_payout_reference` / `supplier_payout_reference` free-text fields exist, no enforced structure | **Gap** — same root cause as the Tampering gap above: no immutable event log. |
| Customer denies placing an order | `mkt_orders.placed_at` + the PayFast `processor_ref` on the linked `mkt_pay_transactions` row | **Mitigated** — an external, third-party-verified payment record exists independent of anything Ballylife itself could alter. |

## Information Disclosure

| Threat | Mitigation | Status |
|---|---|---|
| Order enumeration via `/orders/track` | Requires order number **and** matching email, not either alone; now rate-limited (10/min, Phase 1) | **Mitigated**, with residual risk: an attacker who already has a customer's email (e.g. from a breach elsewhere) can still attempt order-number guesses at 10/min indefinitely — no account lockout or CAPTCHA after repeated misses. |
| Leaking another user's cart/wishlist/addresses | `requireSelf` | **Mitigated** for the routes checked. |
| Leaking PII in logs | Not specifically audited this phase — `console.error` calls throughout the codebase log `m_payment_id`, order ids; none observed logging raw card data (PayFast tokenizes, so there's none to log) or passwords | **Not fully audited** — worth a dedicated grep for `console.log/error` statements that include request bodies wholesale, rather than the current pattern of logging specific named fields. |
| Password hashes | `bcrypt` via `bcryptjs`, standard salted hashing, never returned in any response (`mapUser()` in `authRouter.ts` explicitly whitelists fields) | **Mitigated.** |
| Verbose error messages leaking stack traces | **Verified this phase**: the global error handler (`index.ts`) always returns a fixed `"Internal server error"` string — never `err.message` or `err.stack` — regardless of environment. The real error is only `console.error`'d server-side. | **Mitigated, verified.** |

## Denial of Service

| Threat | Mitigation | Status |
|---|---|---|
| Generic API flooding | Global rate limit, 300 req/min per IP (`index.ts`) | **Mitigated** at a basic level. No distributed/behind-a-shared-NAT consideration (300/min could be tight for many users behind one corporate IP, or loose for a single determined attacker with IP rotation). |
| Credential stuffing on login | `/api/auth` gets a tighter 20/min limit | **Mitigated**, no account-level lockout beyond the IP-based rate limit (an attacker rotating IPs isn't slowed by this). |
| Order/tracking abuse | 10/min and 30/min limits added in Phase 1 | **Mitigated** at the same IP-based level as above. |
| Large payload DoS | `express.json({ limit: "2mb" })` / `express.urlencoded({ limit: "2mb" })` | **Mitigated.** |
| CSV bulk-import abuse (`/admin/supplier-products/bulk-import`) | Admin-role-gated | **Mitigated** via access control; no observed row-count cap on the import itself — an admin account (already a trusted actor) could still submit an extremely large CSV. Low priority given the role gate. |

## Elevation of Privilege

| Threat | Mitigation | Status |
|---|---|---|
| Customer JWT used against an admin route | `requireRole(...MANAGER_ROLES)` checked per Phase 0's route audit — confirmed present on all 53 `/admin/*` routes | **Mitigated.** |
| Role changed after token issued, old token still elevated | JWT carries role at issuance, 8-hour expiry, no revocation list | **Gap**, documented in `docs/architecture.md`. If an admin is demoted, their existing token remains valid at the old role for up to 8 hours. Acceptable for current scale; worth a revocation mechanism (e.g. a `token_version` column on `users`, checked per-request) before this matters more. |
| Seller acting on another seller's products | Route handlers take `:id` (seller id) from the path — **verified this phase**: `requireSellerOwner` (checks `mkt_sellers.user_id === req.user.userId`, or admin role) is applied to every mutating/sensitive `/sellers/:id...` route (analytics, update, orders, supplier-orders, create/update/delete products, import-listing) — 9 routes checked directly. The one exception, `GET /sellers/:id`, deliberately has no owner check since it's a public storefront profile view, same as viewing any product page. | **Mitigated, verified.** Same pattern (`requireSupplierOwner`, `requireShippingOwner`, `requireCreditOwner`, `requireAuthorityOwner`) confirmed present on every `/suppliers/:id`, `/shipping-companies/:id`, `/credit-providers/:id`, and `/revenue-authorities/:id` route with zero exceptions found. |
| OAuth account takeover via email collision | `findOrCreateOauthUser` links a new OAuth login to an existing account by matching email, without re-verifying the requester controls that email beyond what Google/Facebook already asserted | **Accepted risk, not a gap** — Google and Facebook both only return a verified email in their identity payload, so this is standard, correct OAuth-linking behavior, not a shortcut. |

## Priority follow-ups from this document

1. **Append-only audit log for settlement/refund status changes** — larger effort, correctly deferred to a later phase, not urgent at current scale.
2. **Order-tracking lockout** — 10/min rate limit exists (Phase 1), but no lockout after repeated misses against the same order number; low priority given the rate limit already caps the practical attack rate.
3. **PayFast IP-allowlist** — researched in Phase 3 (docs/migration-plan.md item 2): actively researching this changed the recommendation from "add it" to "don't." PayFast's IPs changed with their 2025 AWS migration and have drifted since, with a documented real-world case of a hardcoded list silently rejecting legitimate payments elsewhere. The existing two-layer verification doesn't have that failure mode and is already solid; a third, IP-based layer would trade a currently-reliable check for a less reliable one unless done via live DNS resolution, which needs further confirmation from PayFast's own docs before implementing.

(Two items originally listed here — the ownership-check question and stack-trace exposure — were verified during this phase, not deferred: both check out clean. See Elevation of Privilege and Information Disclosure, above.)
