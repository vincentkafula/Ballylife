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
4. Deploy. On first boot it creates its schema and seeds a handful of
   starter product categories. Check `/health`.

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
- **Payments.** `server/src/services/mktPay.ts` ships with one processor,
  `"manual"` — it accepts any charge and marks it `submitted`/pending,
  with no automated confirmation. That's a deliberate placeholder, not a
  payment gateway. Before going live, add a real processor (Stripe,
  Paystack, Flutterwave, PayFast, whichever fits) as a second
  `MktPayProcessor` in that file — the interface is already there, same
  shape VinkPay uses, so nothing in the order/checkout flow needs to
  change once it's added.

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
