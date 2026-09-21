# Entity Relationship Diagram

28 tables total (`grep -c "CREATE TABLE" server/src/db/schema.sql`). Grouped into
four diagrams by concern rather than one unreadable 28-entity graph. Every
column shown here was read directly from `server/src/db/schema.sql`, not
inferred.

## 1. Core commerce

```mermaid
erDiagram
  users ||--o{ mkt_addresses : has
  users ||--o{ mkt_wishlist_items : has
  users ||--o{ mkt_reviews : writes
  mkt_categories ||--o{ mkt_categories : "parent_id (self-ref)"
  mkt_categories ||--o{ mkt_products : contains
  mkt_sellers ||--o{ mkt_products : lists
  mkt_products ||--o{ mkt_reviews : receives
  mkt_products ||--o{ mkt_wishlist_items : "wishlisted as"
  users ||--o| mkt_carts : owns

  users {
    uuid id PK
    text username UK
    text password_hash
    text role "customer|seller|marketplace_admin|supplier|revenue_authority|shipping_company|credit_provider"
    text email
    text oauth_provider "google|facebook|NULL"
    text oauth_id "partial-unique with oauth_provider"
  }
  mkt_categories {
    text id PK
    text name
    text slug UK
    text parent_id FK
    bool featured
  }
  mkt_sellers {
    text id PK
    text user_id
    text store_name
    text status "pending_kyc|active|suspended|rejected"
    bool kyc_verified
    numeric commission_pct
    jsonb application_data "KYC fields, unstructured"
  }
  mkt_products {
    uuid id PK
    text seller_id FK
    text category_id FK
    numeric price
    text currency
    text status "active|pending_review|inactive|rejected|out_of_stock"
    integer stock
    text sku
  }
  mkt_carts {
    uuid id PK
    text user_id
    jsonb items
    text coupon_code
  }
  mkt_reviews {
    uuid id PK
    uuid product_id FK
    text user_id
    text order_id
    smallint rating
    bool verified_purchase
  }
  mkt_wishlist_items {
    text user_id PK
    uuid product_id PK
  }
  mkt_addresses {
    uuid id PK
    text user_id FK
    bool is_default
  }
  mkt_coupons {
    text code PK
    text type
    numeric value
    text seller_id FK
  }
```

## 2. Orders, payments, settlement (the closest thing to a ledger — see below)

```mermaid
erDiagram
  mkt_orders ||--o{ mkt_pay_transactions : "paid via"
  mkt_orders ||--o{ mkt_order_refunds : "refunded via"
  mkt_orders ||--o{ mkt_order_line_settlements : "settles as"
  mkt_products ||--o{ mkt_order_line_settlements : "sold as"
  mkt_sellers ||--o{ mkt_order_line_settlements : "payout to"
  mkt_suppliers ||--o{ mkt_order_line_settlements : "cost from"
  mkt_shipping_companies ||--o{ mkt_orders : delivers
  mkt_credit_providers ||--o{ mkt_orders : "BNPL decision on"

  mkt_orders {
    uuid id PK
    text order_number UK
    text user_id
    jsonb items
    numeric total_amount
    text currency
    text status "pending|confirmed|payment_failed|delivered|cancelled..."
    text payment_status
    text shipping_status
    text shipping_company_id FK
    text credit_provider_id FK
    text credit_decision "pending|approved|declined"
  }
  mkt_pay_transactions {
    uuid id PK
    uuid order_id FK
    text processor "payfast"
    numeric amount
    text status "submitted|confirmed|failed"
    text processor_ref
    timestamptz webhook_received_at
  }
  mkt_order_refunds {
    uuid id PK
    uuid order_id FK
    uuid product_id FK "NULL = whole-order"
    numeric amount
    text status "pending|processed|failed"
    text initiated_by "admin user id"
  }
  mkt_order_line_settlements {
    uuid id PK
    uuid order_id FK
    uuid product_id FK
    text seller_id FK
    text supplier_id FK "NULL for a local line"
    numeric gross_amount
    numeric platform_fee_pct "snapshot at order time"
    numeric platform_fee_amount
    numeric supplier_cost_amount_zar
    numeric seller_payout_amount
    text supplier_payout_status "pending|paid|n/a"
    text seller_payout_status "pending|paid"
    text seller_payout_reference
    timestamptz seller_paid_at
  }
  mkt_fraud_flags {
    uuid id PK
    text rule
    text severity
    text subject_type
    text subject_id
    text status
  }
```

## 3. Supply chain / logistics

```mermaid
erDiagram
  mkt_suppliers ||--o{ mkt_supplier_products : catalogs
  mkt_supplier_products ||--o{ mkt_supplier_orders : "sourced as"
  mkt_warehouses ||--o{ mkt_shipments : "origin/destination"
  mkt_shipments ||--o{ mkt_supplier_orders : carries
  mkt_shipments ||--o{ mkt_customs_records : "declared as"
  mkt_categories ||--o{ mkt_duty_rates : "rate for"

  mkt_suppliers {
    text id PK
    text country
    text platform
    bool dropship_supported
    bool verified
  }
  mkt_supplier_products {
    uuid id PK
    text supplier_id FK
    numeric cost_price
    numeric retail_price
    integer moq
    text status
  }
  mkt_warehouses {
    text id PK
    text country
    text type
  }
  mkt_shipments {
    uuid id PK
    text origin_warehouse_id FK
    text destination_warehouse_id FK
    text status
    timestamptz customs_cleared_at
  }
  mkt_supplier_orders {
    uuid id PK
    uuid order_id FK
    uuid product_id FK
    text supplier_id FK
    uuid shipment_id FK
    text status
  }
  mkt_customs_records {
    uuid id PK
    uuid shipment_id FK
    numeric declared_value
    numeric duty_amount
    numeric vat_amount
    text status
  }
  mkt_tax_rates {
    text country PK
    numeric vat_rate_pct
    numeric default_duty_rate_pct
  }
  mkt_duty_rates {
    uuid id PK
    text country
    text category_id FK
    numeric duty_rate_pct
  }
  mkt_vehicle_duty_zm {
    uuid id PK
    text body_type
    text age_band
    numeric duty_kwacha
  }
```

## 4. Platform roles & rates

```mermaid
erDiagram
  mkt_revenue_authorities {
    text id PK
    text country
    uuid user_id
    text status
  }
  mkt_shipping_companies {
    text id PK
    uuid user_id
    text status
  }
  mkt_credit_providers {
    text id PK
    text provider_key UK
    uuid user_id
    text status
  }
  mkt_fx_rates {
    text currency PK
    numeric rate_to_zar
    timestamptz updated_at
  }
  password_reset_tokens {
    uuid id PK
    uuid user_id FK
    text token_hash
    timestamptz expires_at
    timestamptz used_at
  }
```

## Ledger design — what actually exists, honestly

**There is no formal double-entry ledger.** No debit/credit pairs, no
append-only enforcement at the database level, no derived-balance-from-
immutable-events model. This section says what actually exists in its place,
not what a bank would need.

`mkt_order_line_settlements` is the closest thing to one, and it's a real,
deliberate design — one row per (order, product line), capturing at order
time:
- `gross_amount` (what the customer paid for that line)
- `platform_fee_pct` / `platform_fee_amount` (Ballylife's cut, snapshotted —
  changing a seller's `commission_pct` later doesn't retroactively change
  already-settled rows)
- `supplier_cost_amount` / `supplier_cost_amount_zar` (converted via
  `mkt_fx_rates` at order time, for drop-shipped lines)
- `seller_payout_amount` (gross − platform fee − supplier cost)
- Two independent status fields — `supplier_payout_status` and
  `seller_payout_status` — each `pending → paid`, moved by an admin action,
  not a scheduled job.

**What this gets right**: money math is computed once, at order time, and
stored — not recomputed live from `mkt_orders.total_amount` every time
someone views a settlement report. That's the right instinct; it means a
later rate change can't silently reshuffle historical numbers.

**What this doesn't have, that a stricter design would**:
1. **Mutability.** `seller_payout_status` is `UPDATE`d in place when an
   admin marks something paid. There's no append-only event log recording
   *who* changed it and *when*, beyond `seller_paid_at`/`seller_payout_reference`
   on the row itself — if a status gets flipped back by mistake, the
   previous state is gone, not superseded by a new immutable row.
2. **No reconciliation table.** There's nothing that periodically checks
   "sum of confirmed `mkt_pay_transactions.amount` for this order equals
   `mkt_orders.total_amount` equals sum of this order's
   `mkt_order_line_settlements.gross_amount`" and flags a mismatch. Today
   that invariant holds only because the code that writes all three is
   careful, not because anything enforces it.
3. **No idempotency key on settlement creation** distinct from the order
   itself — a retry that somehow ran settlement-creation twice for the same
   order would need to be caught by application logic, not a unique
   constraint (there's no `UNIQUE(order_id, product_id)` on
   `mkt_order_line_settlements` as of this schema read).

None of this is wrong for a marketplace moving money through a licensed PSP
(PayFast) rather than holding funds directly — it's a reasonable design for
what Ballylife actually is. It would be wrong to present it as bank-grade
double-entry bookkeeping, which is why this section says plainly that it
isn't one.
