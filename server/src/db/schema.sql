-- ═══════════════════════════════════════════════════════════════════════════
-- Vink Marketplace backend — standalone Postgres schema
--
-- Fully independent of VINK-GRUP-LIMITED's database: its own `users` table
-- (marketplace accounts, not Vink bank accounts), its own JWT secret, and
-- its own payment-transaction ledger (mkt_pay_transactions) instead of
-- Vink's vinkpay_transactions. Table shapes for the mkt_* domain tables are
-- carried over unchanged from VINK-GRUP-LIMITED's schema, since the data
-- model itself (products, orders, sellers, etc.) doesn't need to change —
-- only what it's allowed to depend on.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- for gen_random_uuid()

-- ── Auth — marketplace's own accounts, not Vink's ──────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username       TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'customer', -- customer | seller | marketplace_admin
  name           TEXT NOT NULL,
  email          TEXT NOT NULL,
  last_login     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Marketplace domain ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mkt_categories (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,
  icon          TEXT,
  parent_id     TEXT REFERENCES mkt_categories(id),
  featured      BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS mkt_sellers (
  id              TEXT PRIMARY KEY,
  user_id         TEXT,
  store_name      TEXT NOT NULL,
  store_slug      TEXT UNIQUE NOT NULL,
  description     TEXT,
  logo_url        TEXT,
  banner_url      TEXT,
  email           TEXT,
  phone           TEXT,
  country         TEXT DEFAULT 'ZA',
  status          TEXT NOT NULL DEFAULT 'pending_kyc', -- pending_kyc | active | suspended | rejected
  kyc_verified    BOOLEAN NOT NULL DEFAULT false,
  tax_id          TEXT,
  total_sales     INTEGER NOT NULL DEFAULT 0,
  total_revenue   NUMERIC(14,2) NOT NULL DEFAULT 0,
  avg_rating      NUMERIC(2,1) NOT NULL DEFAULT 0,
  review_count    INTEGER NOT NULL DEFAULT 0,
  commission_pct  NUMERIC(4,1) NOT NULL DEFAULT 8,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Structured data from the seller application wizard (seller type,
  -- personal info, KYC identity fields, address, business info, tax info).
  application_data JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS mkt_products (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id           TEXT NOT NULL REFERENCES mkt_sellers(id),
  category_id         TEXT NOT NULL REFERENCES mkt_categories(id),
  name                TEXT NOT NULL,
  slug                TEXT UNIQUE NOT NULL,
  short_description   TEXT,
  description         TEXT,
  price               NUMERIC(12,2) NOT NULL,
  compare_at_price    NUMERIC(12,2),
  currency            TEXT NOT NULL DEFAULT 'ZAR',
  images              JSONB NOT NULL DEFAULT '[]',
  emoji               TEXT,
  status              TEXT NOT NULL DEFAULT 'pending_review', -- active | pending_review | inactive | rejected | out_of_stock
  stock               INTEGER NOT NULL DEFAULT 0,
  sku                 TEXT,
  brand               TEXT,
  tags                JSONB NOT NULL DEFAULT '[]',
  attributes          JSONB NOT NULL DEFAULT '{}',
  variants            JSONB NOT NULL DEFAULT '[]',
  avg_rating          NUMERIC(2,1) NOT NULL DEFAULT 0,
  review_count        INTEGER NOT NULL DEFAULT 0,
  total_sold          INTEGER NOT NULL DEFAULT 0,
  is_featured         BOOLEAN NOT NULL DEFAULT false,
  is_flash_deal       BOOLEAN NOT NULL DEFAULT false,
  flash_deal_ends_at  TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mkt_products_category ON mkt_products(category_id);
CREATE INDEX IF NOT EXISTS idx_mkt_products_seller   ON mkt_products(seller_id);
CREATE INDEX IF NOT EXISTS idx_mkt_products_status   ON mkt_products(status);

CREATE TABLE IF NOT EXISTS mkt_coupons (
  code                 TEXT PRIMARY KEY,
  type                 TEXT NOT NULL, -- percentage | fixed_amount | free_shipping
  value                NUMERIC(10,2) NOT NULL DEFAULT 0,
  min_order_amount     NUMERIC(10,2) NOT NULL DEFAULT 0,
  max_discount_amount  NUMERIC(10,2),
  usage_limit          INTEGER,
  usage_count          INTEGER NOT NULL DEFAULT 0,
  valid_from           TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to             TIMESTAMPTZ,
  active               BOOLEAN NOT NULL DEFAULT true,
  seller_id            TEXT REFERENCES mkt_sellers(id) -- null = platform-wide
);

CREATE TABLE IF NOT EXISTS mkt_carts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          TEXT UNIQUE NOT NULL,
  items            JSONB NOT NULL DEFAULT '[]',
  coupon_code      TEXT REFERENCES mkt_coupons(code),
  coupon_discount  NUMERIC(10,2) NOT NULL DEFAULT 0,
  subtotal         NUMERIC(12,2) NOT NULL DEFAULT 0,
  shipping         NUMERIC(10,2) NOT NULL DEFAULT 0,
  tax              NUMERIC(10,2) NOT NULL DEFAULT 0,
  total            NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mkt_orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number        TEXT UNIQUE NOT NULL,
  user_id             TEXT NOT NULL,
  customer_name       TEXT,
  customer_email      TEXT,
  items               JSONB NOT NULL DEFAULT '[]',
  subtotal            NUMERIC(12,2) NOT NULL DEFAULT 0,
  shipping_cost       NUMERIC(10,2) NOT NULL DEFAULT 0,
  tax_amount          NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount_amount     NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency            TEXT NOT NULL DEFAULT 'ZAR',
  status              TEXT NOT NULL DEFAULT 'pending',
  payment_status      TEXT NOT NULL DEFAULT 'pending',
  payment_method      TEXT,
  shipping_address    JSONB,
  shipping_status     TEXT NOT NULL DEFAULT 'not_shipped',
  tracking_number     TEXT,
  carrier             TEXT,
  estimated_delivery  TIMESTAMPTZ,
  coupon_code         TEXT,
  notes               TEXT,
  placed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at        TIMESTAMPTZ,
  shipped_at          TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_mkt_orders_user   ON mkt_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_mkt_orders_status ON mkt_orders(status);

CREATE TABLE IF NOT EXISTS mkt_reviews (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          UUID NOT NULL REFERENCES mkt_products(id) ON DELETE CASCADE,
  user_id             TEXT NOT NULL,
  order_id            TEXT,
  rating              SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title               TEXT,
  body                TEXT,
  verified_purchase   BOOLEAN NOT NULL DEFAULT false,
  status              TEXT NOT NULL DEFAULT 'approved',
  helpful             INTEGER NOT NULL DEFAULT 0,
  images              JSONB NOT NULL DEFAULT '[]',
  reviewer_name       TEXT DEFAULT 'Verified Buyer',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mkt_reviews_product ON mkt_reviews(product_id);

CREATE TABLE IF NOT EXISTS mkt_wishlist_items (
  user_id      TEXT NOT NULL,
  product_id   UUID NOT NULL REFERENCES mkt_products(id) ON DELETE CASCADE,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE IF NOT EXISTS mkt_addresses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL,
  label         TEXT DEFAULT 'Home',
  first_name    TEXT,
  last_name     TEXT,
  line1         TEXT,
  line2         TEXT,
  city          TEXT,
  state         TEXT,
  postal_code   TEXT,
  country       TEXT DEFAULT 'ZA',
  phone         TEXT,
  is_default    BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_mkt_addresses_user ON mkt_addresses(user_id);

-- ── Payments — marketplace's own ledger, independent of VinkPay ───────────
-- Same discipline as VinkPay: submitPayment() only ever means "the
-- processor accepted this for processing", never "the money arrived".
-- A row here is written on submission and updated by the webhook/
-- verification path — never optimistically marked paid from the order
-- endpoint itself.
CREATE TABLE IF NOT EXISTS mkt_pay_transactions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              UUID NOT NULL REFERENCES mkt_orders(id),
  processor             TEXT NOT NULL,
  payment_method        TEXT NOT NULL,
  amount                NUMERIC(12,2) NOT NULL,
  currency              TEXT NOT NULL DEFAULT 'ZAR',
  status                TEXT NOT NULL DEFAULT 'submitted', -- submitted | confirmed | failed
  processor_ref         TEXT,
  error_message         TEXT,
  webhook_received_at   TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mkt_pay_tx_order ON mkt_pay_transactions(order_id);

-- ── Fraud & risk — same rule-based, flag-only pattern, own table ──────────
CREATE TABLE IF NOT EXISTS mkt_fraud_flags (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule          TEXT NOT NULL,
  severity      TEXT NOT NULL DEFAULT 'warning',
  subject_type  TEXT NOT NULL,
  subject_id    TEXT NOT NULL,
  related_ids   JSONB NOT NULL DEFAULT '[]',
  message       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open', -- open | dismissed | confirmed
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ,
  resolved_by   TEXT,
  resolution_reason TEXT
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Supply chain — international supplier sourcing + dropship-to-warehouse
-- fulfilment, and the "SellerListing" reseller layer on top of it.
--
-- A local seller (South Africa / Zambia) never talks to a supplier
-- directly. They browse mkt_supplier_products (a catalog Ballylife's own
-- sourcing/ops team vets and prices), pick one, and mkt_products picks up
-- fulfillment_type='imported' + supplier_product_id (added via ALTER
-- below). The physical goods flow supplier -> origin warehouse (QC +
-- consolidation) -> destination warehouse (customs + final QC) -> customer,
-- tracked per order-line in mkt_supplier_orders and batched for the
-- second leg in mkt_shipments.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mkt_suppliers (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  country           TEXT NOT NULL, -- CN | JP | KR (ISO-3166 alpha-2)
  contact_name      TEXT,
  contact_email     TEXT,
  contact_phone     TEXT,
  platform          TEXT,          -- e.g. "Alibaba", "1688", "KOTRA/Gobizkorea", "JETRO"
  payment_terms     TEXT,          -- e.g. "30% deposit / 70% on shipment"
  lead_time_days    INTEGER NOT NULL DEFAULT 14,
  dropship_supported BOOLEAN NOT NULL DEFAULT true,
  verified          BOOLEAN NOT NULL DEFAULT false,
  status            TEXT NOT NULL DEFAULT 'active', -- active | suspended
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mkt_suppliers_country ON mkt_suppliers(country);
-- Links a supplier record to a login (users.role = 'supplier') so the
-- supplier can sign in and manage their own catalog/profile/orders.
-- Nullable: most suppliers are entered and managed by Ballylife staff
-- with no login of their own; only ones an admin explicitly onboards
-- (POST /admin/suppliers/:id/create-login) get one.
ALTER TABLE mkt_suppliers ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);

-- The vetted, cost-priced catalog local sellers import listings from.
-- cost_price is what Ballylife pays the supplier (landed at the origin
-- warehouse); it is never shown to customers, only to admins reconciling
-- supplier payouts. retail_price / compare_at_price are the price and any
-- discount the supplier relationship is sold at — set here by a manager on
-- the supplier's behalf, not by the seller. Importing a listing copies
-- these onto the resulting mkt_products row; editing them afterward is
-- restricted to managers (see PATCH /sellers/:id/products/:productId).
CREATE TABLE IF NOT EXISTS mkt_supplier_products (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id       TEXT NOT NULL REFERENCES mkt_suppliers(id),
  category_id       TEXT REFERENCES mkt_categories(id),
  name              TEXT NOT NULL,
  description       TEXT,
  cost_price        NUMERIC(12,2) NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'USD',
  retail_price      NUMERIC(12,2) NOT NULL DEFAULT 0, -- ZAR — supplier/manager-set selling price
  compare_at_price  NUMERIC(12,2), -- ZAR — supplier/manager-set "was" price for a discount, if any
  moq               INTEGER NOT NULL DEFAULT 1,
  images            JSONB NOT NULL DEFAULT '[]',
  emoji             TEXT,
  origin_country    TEXT NOT NULL, -- CN | JP | KR
  status            TEXT NOT NULL DEFAULT 'active', -- active | inactive | pending_review (a supplier-submitted new item awaiting manager approval)
  import_count      INTEGER NOT NULL DEFAULT 0, -- how many SellerListings currently reference this
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mkt_supplier_products_supplier ON mkt_supplier_products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_mkt_supplier_products_status   ON mkt_supplier_products(status);

CREATE TABLE IF NOT EXISTS mkt_warehouses (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  country      TEXT NOT NULL, -- CN | JP | KR | ZA | ZM
  type         TEXT NOT NULL, -- origin | destination
  address      TEXT,
  status       TEXT NOT NULL DEFAULT 'active', -- active | inactive
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Consolidated second-leg freight: many mkt_supplier_orders (once QC'd at
-- an origin hub) get grouped into one mkt_shipments row bound for a single
-- destination warehouse, rather than each order travelling internationally
-- on its own.
CREATE TABLE IF NOT EXISTS mkt_shipments (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_warehouse_id      TEXT NOT NULL REFERENCES mkt_warehouses(id),
  destination_warehouse_id TEXT NOT NULL REFERENCES mkt_warehouses(id),
  status                 TEXT NOT NULL DEFAULT 'preparing',
  -- preparing | in_transit | received_at_destination | customs_cleared | closed
  carrier                TEXT,
  tracking_number        TEXT,
  dispatched_at          TIMESTAMPTZ,
  received_at            TIMESTAMPTZ,
  customs_cleared_at     TIMESTAMPTZ,
  closed_at              TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mkt_shipments_status ON mkt_shipments(status);

-- One row per imported order-line — the unit that actually moves through
-- the two-leg pipeline. Kept separate from mkt_orders.items (which stays a
-- JSONB snapshot for the customer-facing order) because this needs its own
-- mutable status machine, FK relationships to supplier/warehouse/shipment,
-- and admin/ops queries (by supplier, by warehouse, by shipment) that a
-- JSONB blob can't support well.
CREATE TABLE IF NOT EXISTS mkt_supplier_orders (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                 UUID NOT NULL REFERENCES mkt_orders(id),
  product_id               UUID NOT NULL REFERENCES mkt_products(id),
  supplier_id              TEXT NOT NULL REFERENCES mkt_suppliers(id),
  supplier_product_id      UUID NOT NULL REFERENCES mkt_supplier_products(id),
  seller_id                TEXT NOT NULL REFERENCES mkt_sellers(id),
  quantity                 INTEGER NOT NULL,
  cost_amount              NUMERIC(12,2) NOT NULL, -- cost_price * quantity, locked at order time
  origin_warehouse_id      TEXT NOT NULL REFERENCES mkt_warehouses(id),
  destination_warehouse_id TEXT NOT NULL REFERENCES mkt_warehouses(id),
  shipment_id              UUID REFERENCES mkt_shipments(id), -- set once batched for the 2nd leg
  status                   TEXT NOT NULL DEFAULT 'ordered_from_supplier',
  -- ordered_from_supplier | received_at_origin_hub | qc_passed_origin | qc_failed_origin
  -- | in_transit_to_destination | received_at_destination_hub | customs_cleared
  -- | shipped_to_customer | delivered
  qc_notes                 TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mkt_supplier_orders_order     ON mkt_supplier_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_mkt_supplier_orders_status    ON mkt_supplier_orders(status);
CREATE INDEX IF NOT EXISTS idx_mkt_supplier_orders_shipment  ON mkt_supplier_orders(shipment_id);
CREATE INDEX IF NOT EXISTS idx_mkt_supplier_orders_seller    ON mkt_supplier_orders(seller_id);

-- ── mkt_products: link a seller's listing back to its supplier-catalog
-- source when it's an imported item, rather than seller-sourced locally.
-- ALTER ... ADD COLUMN IF NOT EXISTS so this applies cleanly to both a
-- fresh database and an existing deployment that already has mkt_products.
ALTER TABLE mkt_products ADD COLUMN IF NOT EXISTS fulfillment_type TEXT NOT NULL DEFAULT 'local'; -- local | imported
ALTER TABLE mkt_products ADD COLUMN IF NOT EXISTS supplier_product_id UUID REFERENCES mkt_supplier_products(id);
CREATE INDEX IF NOT EXISTS idx_mkt_products_supplier_product ON mkt_products(supplier_product_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Tax & customs — per-country VAT/duty rates, and per-shipment customs
-- clearance tracking.
--
-- IMPORTANT: this system calculates what's owed and tracks what's been
-- paid — it does NOT submit declarations to SARS or ZRA, and it does NOT
-- move money to either authority. Both countries require declarations to
-- go through an accredited/licensed clearing agent (SARS EDI-accredited
-- entity, or a ZRA-licensed agent via ASYCUDA World); there is no
-- self-service API for an unaccredited business to pay customs directly.
-- clearing_agent/reference_number on mkt_customs_records exist to record
-- whichever broker or courier (or, once accredited, Ballylife itself)
-- actually handles that step.
-- ═══════════════════════════════════════════════════════════════════════════

-- One row per destination country: the VAT rate charged to customers on
-- every sale (domestic tax law, applies regardless of fulfillment_type),
-- and a fallback duty rate for imported items whose category has no
-- specific override in mkt_duty_rates below.
CREATE TABLE IF NOT EXISTS mkt_tax_rates (
  country                 TEXT PRIMARY KEY, -- ZA | ZM | ... (ISO-3166 alpha-2)
  vat_rate_pct            NUMERIC(5,2) NOT NULL,
  default_duty_rate_pct   NUMERIC(5,2) NOT NULL DEFAULT 0,
  notes                   TEXT,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Category-specific import duty override for a country — duty rates
-- genuinely vary by HS code (e.g. SA clothing 45% vs phones/laptops 0%
-- under WTO ITA), and mkt_categories is the closest classification this
-- app already has. These starting values are illustrative, sourced from
-- each country's published tariff bands, NOT a confirmed per-product HS
-- classification — a manager should verify/adjust the exact rate for
-- each real product before relying on it for an actual filing.
CREATE TABLE IF NOT EXISTS mkt_duty_rates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country        TEXT NOT NULL REFERENCES mkt_tax_rates(country),
  category_id    TEXT NOT NULL REFERENCES mkt_categories(id),
  duty_rate_pct  NUMERIC(5,2) NOT NULL,
  notes          TEXT,
  UNIQUE (country, category_id)
);

-- Customs clearance happens per SHIPMENT (the consolidated freight that
-- actually crosses the border), not per order line — duty/VAT here is
-- import tax owed to the destination country's customs authority on the
-- shipment's declared (CIF-ish) value, separate from the VAT collected
-- from end customers on mkt_orders.tax_amount. status tracks the real
-- workflow: computed in-system -> funds handed to whichever accredited
-- courier/broker declares it -> that broker's declaration accepted ->
-- goods released. Nothing here is submitted automatically to SARS/ZRA;
-- an admin (or the broker's own system) updates status as it actually
-- happens.
CREATE TABLE IF NOT EXISTS mkt_customs_records (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id           UUID NOT NULL UNIQUE REFERENCES mkt_shipments(id),
  destination_country   TEXT NOT NULL REFERENCES mkt_tax_rates(country),
  declared_value        NUMERIC(14,2) NOT NULL DEFAULT 0, -- sum of supplier cost_amount for orders in this shipment
  duty_amount           NUMERIC(14,2) NOT NULL DEFAULT 0,
  vat_amount            NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_payable         NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency              TEXT NOT NULL DEFAULT 'ZAR',
  clearing_agent        TEXT, -- broker/courier name, or "Ballylife (accredited)" once that's real
  reference_number      TEXT, -- customs declaration / broker reference
  status                TEXT NOT NULL DEFAULT 'duty_calculated',
  -- duty_calculated | prepaid_to_agent | declared_to_customs | cleared | held
  prepaid_at            TIMESTAMPTZ,
  declared_at           TIMESTAMPTZ,
  cleared_at            TIMESTAMPTZ,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mkt_customs_records_status ON mkt_customs_records(status);

-- mkt_orders: the VAT charged to the customer used to be a hardcoded 15%
-- regardless of destination — duty_amount is new (import duty is never
-- charged to the customer directly, but tracked here so an order's full
-- landed-cost picture is visible to admins reconciling against
-- mkt_customs_records).
ALTER TABLE mkt_orders ADD COLUMN IF NOT EXISTS duty_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
