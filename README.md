# Ballylife (standalone)

Extracted from `VINK-GRUP-LIMITED` into its own app: separate frontend,
separate backend, separate database, separate accounts, separate JWT.
Nothing in this repo depends on Vink's backend at runtime.

```
/                 → frontend (Vite + React), deploy as Railway service #1
/server           → backend (Express + Postgres), deploy as Railway service #2
```

This mirrors the same root-frontend / server-backend pattern
VINK-GRUP-LIMITED itself uses, so if you've deployed that repo to Railway
before, this works the same way — two services pointed at the same repo
with different root/start settings.

## 1. Deploy the backend first

1. New Railway service → deploy from this repo, root directory `server/`.
2. Add a Postgres database to the project (Railway → New → Database →
   PostgreSQL) and let Railway inject `DATABASE_URL` automatically, or set
   it yourself.
3. Set environment variables (see `server/.env.example`):
   - `DATABASE_URL` — set automatically if you used Railway's Postgres
   - `MARKETPLACE_JWT_SECRET` — long random string, **must differ from**
     VINK-GRUP-LIMITED's own JWT secret
   - `MARKETPLACE_ALLOWED_ORIGINS` — the frontend's Railway URL, once you
     know it (step 2). Comma-separated if there's more than one.
4. Deploy. On first boot it applies its schema and seeds the full
   catalog (~200,000 products across 40+ categories, all 54 African
   countries plus every other country in the world for the currency
   selector, and more) — see `docs/erd.md` for what actually ends up in
   the database and `docs/architecture.md` for the full system picture.
   This takes longer than a typical first boot; check Railway's deploy
   logs rather than assuming a slow health check means something's
   wrong. Check `/health` once it settles.

## 2. Deploy the frontend

1. New Railway service → same repo, root directory `/` (default).
2. Set `VITE_API_URL` to the backend service's public URL from step 1.
3. Deploy.
4. Go back to the backend service and set `MARKETPLACE_ALLOWED_ORIGINS`
   to this frontend's URL, then redeploy the backend so CORS allows it.

## 3. Point VINK-GRUP-LIMITED at it

In the main Vink app's frontend service, set `VITE_MARKETPLACE_URL` to
this frontend's deployed URL. Every "Marketplace" entry point in that app
(app icon, header nav, persistent top nav, old `/marketplace` bookmarks)
now opens this app in a new tab/redirect instead of mounting an in-app
component.

## Local development

`docker compose up` runs the whole stack (Postgres + backend + frontend)
locally, self-migrating the same way production does. See
`docker-compose.yml` and `server/.env.example` / `.env.example` (root)
for every environment variable either service actually reads. Not
independently verified end-to-end in the environment this was built in
(no Docker daemon available there) — every port and variable was checked
by hand against the real Dockerfiles and source instead; worth a real
`docker compose up` test before relying on it for onboarding a new
developer.

## Google / Facebook sign-in

Built and tested, inactive until real credentials exist — same
situation as payments above. See `server/.env.example` for
`GOOGLE_CLIENT_ID` / `FACEBOOK_APP_ID` (backend) and
`VITE_GOOGLE_CLIENT_ID` / `VITE_FACEBOOK_APP_ID` (frontend, root
`.env.example`), and `GET /api/auth/oauth-config` to check current
status without digging through Railway's dashboard.

## Further documentation

`docs/` has the rest: `architecture.md` (C4 diagrams, what's actually
deployed), `erd.md` (every table, plus an honest writeup of what the
settlement design is and isn't), `openapi.yaml` (the real API contract),
`threat-model.md` (STRIDE, each finding tied to real code),
`migration-plan.md` (concrete next steps for the gaps threat-model.md
found), `production-readiness.md` (the backup gap that needs fixing —
see below — plus IaC/observability/load-testing findings), and
`pentest-checklist.md` (grounded in the threat model, not written
independently of it).

## ⚠️ Before this takes real traffic: enable database backups

Checked directly against Railway's live service config: **no backup
protection exists right now** — no scheduled snapshots, no
point-in-time recovery, nothing beyond Railway's baseline volume
durability. This can't be fixed from a commit; it's a Railway dashboard
action. Full steps (5 minutes, no downtime) are in
`docs/production-readiness.md`. Do this before the payment credentials
above, not after — an unrecoverable database matters more than a
placeholder payment processor.

## What's genuinely independent vs. what to still decide

**Independent (done):**
- Accounts — its own `users` table, its own bcrypt+JWT auth
  (`/api/auth/register`, `/login`, `/me`). A marketplace login has
  nothing to do with a Vink bank login anymore.
- Data — its own Postgres tables (`mkt_*`), not VINK-GRUP-LIMITED's
  database.
- Fraud checks — its own `mkt_fraud_flags` table, same rule-based
  velocity-check pattern as Vink's, ported and adapted.

**Needs a decision before this takes real money:**
- **Payments.** The code is genuinely complete, not a placeholder --
  `server/src/services/payfastProcessor.ts` implements real PayFast
  signature verification, a server-to-server confirmation round-trip,
  and the ITN webhook handler (`POST /api/marketplace/payfast/notify`)
  that actually confirms orders. **But it is not active in production
  right now** -- checked directly against Railway's live environment
  variables: `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`,
  `PAYFAST_PASSPHRASE`, `PAYFAST_MODE`, `MARKETPLACE_PUBLIC_URL`, and
  `MARKETPLACE_API_PUBLIC_URL` are all currently unset, so
  `payfastProcessor.isConfigured()` returns `false` and every payment
  (even ones with `paymentMethod: "payfast"` or `"card"`) silently
  falls back to the `manual` processor, which just records the charge
  as pending with no automated confirmation. See
  `server/.env.example` for all six variables and where to get them
  from your PayFast merchant account. Setting them is the single
  highest-priority item to make this a real, live storefront --
  everything downstream of checkout (order confirmation emails, the
  webhook, refunds) is already built and tested against them.
  `bank_transfer` and `wallet` payment methods stay on the manual
  processor either way -- add a second `MktPayProcessor` for those if
  you want them automated too, same interface PayFast implements.

## Known leftover in VINK-GRUP-LIMITED

The old marketplace tables (`mkt_categories`, `mkt_sellers`,
`mkt_products`, etc.) still exist in VINK-GRUP-LIMITED's `schema.sql` and
possibly its live database. Nothing references them anymore, so they're
inert, but I deliberately didn't write a migration to drop them or copy
existing rows over to this new database — that's a real decision about
production data (do you have live sellers/products/orders worth
migrating?) that shouldn't happen silently. If there's real data there,
migrate it manually with a one-off script before dropping those tables.

Also: `VINK-GRUP-LIMITED`'s `src/app/services/demoMode.ts` still has an
unused "Marketplace Mock Data" block (it backed the old marketplaceApi's
offline demo mode, which is now deleted). It's dead code, harmless, safe
to remove whenever convenient.
