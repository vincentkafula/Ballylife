# Architecture

This reflects what's actually deployed (verified against `server/src/index.ts`,
`Dockerfile`, `server/Dockerfile`, and Railway's live service list as of Phase 0/1
of the audit this document came out of) — not an aspirational target.

## C4: System Context

```mermaid
C4Context
  title Ballylife — System Context

  Person(customer, "Customer", "Browses, buys, tracks orders")
  Person(seller, "Seller", "Lists products, fulfils orders")
  Person(supplier, "Supplier", "Fulfils drop-shipped lines")
  Person(shipper, "Shipping company", "Claims, picks up, delivers orders")
  Person(credit, "Credit provider", "Approves/declines BNPL orders")
  Person(authority, "Revenue authority", "Views customs/tax records")
  Person(admin, "Marketplace admin", "Manages catalog, refunds, settlements, rates")

  System(ballylife, "Ballylife", "Marketplace: catalog, cart, checkout, multi-role dashboards")

  System_Ext(payfast, "PayFast", "South African payment service provider — tokenizes cards, processes payment, posts back via signed webhook")
  System_Ext(google, "Google Identity Services", "OAuth sign-in (ID token verification only, no secret exchange)")
  System_Ext(facebook, "Facebook Login", "OAuth sign-in (Graph API token verification)")
  System_Ext(ipapi, "ip-api.com", "IP to country lookup")
  System_Ext(nominatim, "OpenStreetMap Nominatim", "Lat/lng to country reverse geocoding")
  System_Ext(smtp, "SMTP provider", "Password reset / order confirmation email — optional, feature no-ops if unconfigured")

  Rel(customer, ballylife, "Browses, buys, tracks — HTTPS")
  Rel(seller, ballylife, "Manages store — HTTPS")
  Rel(supplier, ballylife, "Manages catalog/orders — HTTPS")
  Rel(shipper, ballylife, "Claims/updates deliveries — HTTPS")
  Rel(credit, ballylife, "Approves/declines BNPL — HTTPS")
  Rel(authority, ballylife, "Views tax/customs — HTTPS")
  Rel(admin, ballylife, "Administers — HTTPS")

  Rel(ballylife, payfast, "Redirects for checkout; verifies signed ITN webhook")
  Rel(ballylife, google, "Verifies ID token (JWKS)")
  Rel(ballylife, facebook, "Verifies access token (Graph API)")
  Rel(ballylife, ipapi, "IP geolocation (fire-and-forget, falls back to default)")
  Rel(ballylife, nominatim, "Reverse geocode (user-initiated 'use my location')")
  Rel(ballylife, smtp, "Sends transactional email (optional)")
```

## C4: Container

```mermaid
C4Container
  title Ballylife — Containers (as actually deployed on Railway)

  Person(user, "Any of the 7 user roles above")

  Container_Boundary(railway, "Railway project") {
    Container(frontend, "ballylife-frontend", "React 18 + Vite, served by nginx", "PWA — installable, standalone-mode UI differs from browser mode (no footer). Built with VITE_API_URL baked in at build time, not runtime.")
    Container(backend, "ballylife-backend", "Node 20 + Express + TypeScript", "115 marketplace routes + 9 auth routes + 4 geo/currency routes. Self-migrates schema + seed data on boot (server/src/db/migrate.ts) — no separate migration step or tool.")
    ContainerDb(postgres, "Postgres", "Railway-managed Postgres 16", "28 tables. Single database, no read replica, no separate reporting store.")
  }

  Rel(user, frontend, "HTTPS")
  Rel(frontend, backend, "HTTPS / JSON, Bearer JWT", "VITE_API_URL")
  Rel(backend, postgres, "SQL, TLS (PGSSL=true in prod)", "DATABASE_URL")
```

## What this is not (yet)

- **No API gateway / BFF layer** — the frontend calls `marketplaceRouter`/`authRouter`/`geoRouter` directly. Fine at current scale; would need revisiting before adding a second frontend (e.g. a real native mobile app) that wants a different API shape.
- **No message queue / async job runner** — everything is a synchronous HTTP request-response. There is no background worker for, e.g., retrying a failed supplier-payout webhook or batching settlement runs. `mkt_order_line_settlements` rows are updated in place by admin action, not by a scheduled job.
- **No cache layer** (Redis or similar) — every catalog request hits Postgres directly. At 200k+ products this is worth watching if traffic grows; not an issue at current load.
- **No CDN in front of the frontend** beyond whatever Railway/nginx does by default — static assets aren't fronted by a separate CDN.
- **Single region** — Railway's `sfo` region for Postgres (per the volume region seen in deploy status); no multi-region failover.

## Auth architecture (as built)

Two **separate** JWT-based auth systems exist in this codebase's broader monorepo history: Ballylife's own (`server/src/middleware/auth.ts`, `MARKETPLACE_JWT_SECRET`) and VINK-GRUP-LIMITED's (a different, unrelated system) — deliberately non-interchangeable secrets so a token from one is never valid on the other. This document only covers Ballylife's.

- Stateless JWT, 8-hour expiry (`JWT_EXPIRES = "8h"` in `auth.ts`), no refresh-token rotation implemented.
- Role carried in the JWT payload itself (`customer | seller | marketplace_admin | supplier | revenue_authority | shipping_company | credit_provider`), checked via `requireRole(...)` middleware — not re-fetched from the database per request. **Consequence**: if an admin's role is downgraded, their existing token remains valid with the old role until it expires (up to 8 hours) or they log out. No token revocation list exists.
- OAuth (Google/Facebook) issues the same JWT shape as password login — see `docs/threat-model.md` for how identity-linking-by-email is handled there.
