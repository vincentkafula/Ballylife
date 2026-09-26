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

-- ═══════════════════════════════════════════════════════════════════════════
-- Revenue authority portal — a read-only, country-scoped view of VAT/duty
-- figures for whichever national tax authority (SARS, ZRA, or another
-- country's equivalent) Ballylife has an actual reporting/data-sharing
-- agreement with. This is NOT a payment channel: no money moves through
-- this system to any authority, and being listed here does not constitute
-- or imply that agreement exists — mkt_revenue_authorities.status tracks
-- Ballylife's own record of where that relationship actually stands.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS mkt_revenue_authorities (
  id            TEXT PRIMARY KEY, -- e.g. 'sars-za', 'zra-zm'
  name          TEXT NOT NULL,    -- e.g. "South African Revenue Service"
  country       TEXT NOT NULL UNIQUE REFERENCES mkt_tax_rates(country), -- one authority per country
  contact_name  TEXT,
  contact_email TEXT,
  status        TEXT NOT NULL DEFAULT 'not_agreed', -- not_agreed | agreement_pending | active
  notes         TEXT,
  user_id       UUID REFERENCES users(id), -- set once an admin onboards a login for them
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Vehicles department — real cars supplied from Japan/China suppliers,
-- sold through the same catalog/import/order pipeline as everything else,
-- with vehicle-specific compliance rules layered on top:
--
--   South Africa: ITAC restricts used/second-hand vehicle imports to
--   narrow personal exemptions (returning residents, inheritance, vintage
--   40+ years, disability) — commercial resale of used vehicles is not
--   permitted. NEW vehicles are allowed but require an NRCS Letter of
--   Authority (type-approval) per model before they can be sold to a
--   South African address. Both rules are enforced at order time, not
--   just documented — see the check in POST /orders.
--
--   Zambia: no such restriction — ZRA taxes used vehicles on a flat
--   specific-duty schedule by body type, engine size, and age band
--   (2-5 years / 5+ years), switching to ad valorem (% of CIF) only for
--   vehicles under 2 years old or hybrids/EVs. mkt_vehicle_duty_zm below
--   holds that schedule; it is NOT the same mechanism as mkt_duty_rates
--   (which is percentage-based and used for South Africa's new-vehicle
--   duty and every other category/country).
-- ═══════════════════════════════════════════════════════════════════════════

-- Vehicle-specific fields, added to both the supplier catalog and the
-- resulting seller listing. condition is the field the SA compliance
-- check keys off; nrcs_approved/nrcs_reference track the (real, external)
-- NRCS Letter of Authority for a given model — false until a manager has
-- actually obtained one, never inferred or defaulted true.
ALTER TABLE mkt_supplier_products ADD COLUMN IF NOT EXISTS vehicle_details JSONB;
-- { "make": "Toyota", "model": "Corolla", "year": 2025, "mileageKm": 12,
--   "engineCc": 1800, "bodyType": "sedan", "transmission": "automatic",
--   "fuelType": "petrol", "vin": "..." }
ALTER TABLE mkt_supplier_products ADD COLUMN IF NOT EXISTS condition TEXT; -- 'new' | 'used' — NULL for non-vehicle items
ALTER TABLE mkt_supplier_products ADD COLUMN IF NOT EXISTS nrcs_approved BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE mkt_supplier_products ADD COLUMN IF NOT EXISTS nrcs_reference TEXT;

ALTER TABLE mkt_products ADD COLUMN IF NOT EXISTS vehicle_details JSONB;
ALTER TABLE mkt_products ADD COLUMN IF NOT EXISTS condition TEXT;
ALTER TABLE mkt_products ADD COLUMN IF NOT EXISTS nrcs_approved BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE mkt_products ADD COLUMN IF NOT EXISTS nrcs_reference TEXT;

-- Zambia's ZRA specific-duty schedule for used vehicles 2+ years old —
-- flat kwacha amounts, not a percentage. Rates below are illustrative,
-- transcribed from ZRA's published schedule at the time this was built;
-- ZRA updates this schedule annually (each July) — verify current rates
-- before relying on this for an actual declaration. Vehicles under 2
-- years old, and all hybrids/EVs regardless of age, use the ordinary
-- percentage-based mkt_duty_rates system instead (25% duty + 30% excise
-- + 16% VAT on CIF, per ZRA's ad valorem method for those categories) —
-- not modelled as a separate flat row here.
CREATE TABLE IF NOT EXISTS mkt_vehicle_duty_zm (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  body_type         TEXT NOT NULL, -- sedan | hatchback | station_wagon | suv | pickup_single_cab | pickup_double_cab | panel_van
  engine_cc_min     INTEGER NOT NULL DEFAULT 0,
  engine_cc_max     INTEGER, -- NULL = no upper bound ("over Xcc")
  age_band          TEXT NOT NULL, -- '2_to_5' | '5_plus'
  duty_kwacha       NUMERIC(12,2) NOT NULL,
  carbon_surtax_kwacha NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes             TEXT,
  UNIQUE (body_type, engine_cc_min, engine_cc_max, age_band)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Settlement ledger — the four-way split every order actually implies:
-- supplier gets their price, seller gets their margin, Ballylife keeps a
-- platform fee (seller.commission_pct, already existed but was previously
-- only displayed, never applied), and the tax/duty side is already
-- tracked separately (mkt_orders.tax_amount / duty_amount,
-- mkt_customs_records). This computes what's owed to whom per order line
-- — it does NOT move money; marking something "paid" here just records
-- that Ballylife settled it through whatever real payment channel
-- (bank transfer, etc.) it actually used.
-- ═══════════════════════════════════════════════════════════════════════════

-- Admin-maintained conversion rates so a supplier's cost (quoted in USD/
-- CNY/JPY/KRW) can be expressed in ZAR for settlement math — illustrative
-- rates only; a real payout run should use the rate on the actual day of
-- payment, not a static table like this one.
CREATE TABLE IF NOT EXISTS mkt_fx_rates (
  currency      TEXT PRIMARY KEY, -- USD | CNY | JPY | KRW
  rate_to_zar   NUMERIC(10,4) NOT NULL, -- 1 unit of currency = this many ZAR
  notes         TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per order line (a single order can span multiple sellers and
-- multiple suppliers, since mkt_orders.items is a mixed cart) — computed
-- at order-placement time alongside tax/duty, in POST /orders.
CREATE TABLE IF NOT EXISTS mkt_order_line_settlements (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                 UUID NOT NULL REFERENCES mkt_orders(id),
  product_id               UUID NOT NULL REFERENCES mkt_products(id),
  seller_id                TEXT NOT NULL REFERENCES mkt_sellers(id),
  supplier_id              TEXT REFERENCES mkt_suppliers(id), -- NULL for a locally-sourced line
  quantity                 INTEGER NOT NULL,
  gross_amount             NUMERIC(12,2) NOT NULL, -- price * quantity, ZAR, excludes tax/duty/shipping
  platform_fee_pct         NUMERIC(4,1) NOT NULL,  -- seller.commission_pct at order time
  platform_fee_amount      NUMERIC(12,2) NOT NULL,
  supplier_cost_amount     NUMERIC(12,2), -- in supplier_cost_currency, NULL for a local line
  supplier_cost_currency   TEXT,
  supplier_cost_amount_zar NUMERIC(12,2), -- converted via mkt_fx_rates at order time
  seller_payout_amount     NUMERIC(12,2) NOT NULL, -- gross - platform fee - supplier cost (ZAR)
  supplier_payout_status   TEXT NOT NULL DEFAULT 'pending', -- pending | paid | n/a (n/a for local lines)
  seller_payout_status     TEXT NOT NULL DEFAULT 'pending', -- pending | paid
  supplier_payout_reference TEXT,
  seller_payout_reference  TEXT,
  supplier_paid_at         TIMESTAMPTZ,
  seller_paid_at           TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mkt_settlements_order    ON mkt_order_line_settlements(order_id);
CREATE INDEX IF NOT EXISTS idx_mkt_settlements_seller   ON mkt_order_line_settlements(seller_id);
CREATE INDEX IF NOT EXISTS idx_mkt_settlements_supplier ON mkt_order_line_settlements(supplier_id);

-- Password reset — a random token is generated and only its SHA-256 hash
-- is stored (same discipline as never storing the password itself), so a
-- database read alone can't be used to reset someone's account. One-time
-- use (used_at) and short-lived (expires_at, set to +1 hour at creation).
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);

-- Line-level (or whole-order, when product_id is NULL) refunds — the
-- previous refund path only ever refunded an entire order even for a
-- single bad item. Tracks the actual refund attempt against whichever
-- payment processor handled the order (via mkt_pay_transactions), and
-- mkt_orders.refunded_amount is the running total so a partially-
-- refunded order can be told apart from a fully-refunded one.
CREATE TABLE IF NOT EXISTS mkt_order_refunds (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       UUID NOT NULL REFERENCES mkt_orders(id),
  product_id     UUID REFERENCES mkt_products(id), -- NULL = whole-order refund
  quantity       INTEGER,
  amount         NUMERIC(12,2) NOT NULL,
  reason         TEXT,
  status         TEXT NOT NULL DEFAULT 'pending', -- pending | processed | failed
  processor_ref  TEXT,
  initiated_by   TEXT, -- admin user id
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mkt_order_refunds_order ON mkt_order_refunds(order_id);

ALTER TABLE mkt_orders ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

-- ── Shipping companies and credit providers ───────────────────────────────
-- Two more real role types, following the exact same pattern as
-- mkt_suppliers/mkt_revenue_authorities: a dedicated profile table,
-- linked to a users row via user_id once someone (admin, or the seed
-- script for the demo login) onboards a login for them. Being able to
-- sign in does not by itself mean anything about the underlying
-- business relationship -- same caveat as the revenue-authority table.

CREATE TABLE IF NOT EXISTS mkt_shipping_companies (
  id             TEXT PRIMARY KEY, -- e.g. 'ship-dhl-za'
  name           TEXT NOT NULL,    -- e.g. "DHL Express"
  country        TEXT,
  contact_name   TEXT,
  contact_email  TEXT,
  status         TEXT NOT NULL DEFAULT 'active', -- active | suspended
  user_id        UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mkt_credit_providers (
  id             TEXT PRIMARY KEY,   -- e.g. 'cred-payflex'
  name           TEXT NOT NULL,      -- e.g. "PayFlex"
  provider_key   TEXT UNIQUE NOT NULL, -- e.g. 'payflex' -- matches the suffix on
                                        -- mkt_orders.payment_method ('bnpl_payflex'),
                                        -- so an order can be routed to the right
                                        -- provider's dashboard without guessing
  contact_name   TEXT,
  contact_email  TEXT,
  status         TEXT NOT NULL DEFAULT 'active',
  user_id        UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Which shipping company has an order, and the delivery signature that
-- closes out the fulfilment leg -- "bring it back with the sign detail"
-- as the actual proof of delivery, not just a status flag.
ALTER TABLE mkt_orders ADD COLUMN IF NOT EXISTS shipping_company_id TEXT REFERENCES mkt_shipping_companies(id);
ALTER TABLE mkt_orders ADD COLUMN IF NOT EXISTS delivery_signed_by TEXT;
ALTER TABLE mkt_orders ADD COLUMN IF NOT EXISTS delivery_signed_at TIMESTAMPTZ;

-- Which credit provider is being asked to lend, and their decision.
-- Set at checkout time for any bnpl_* payment method (see
-- marketplaceRouter.ts POST /orders); NULL for every other payment
-- method, since only a credit purchase involves a third party actually
-- deciding whether to lend.
ALTER TABLE mkt_orders ADD COLUMN IF NOT EXISTS credit_provider_id TEXT REFERENCES mkt_credit_providers(id);
ALTER TABLE mkt_orders ADD COLUMN IF NOT EXISTS credit_decision TEXT; -- pending | approved | declined
ALTER TABLE mkt_orders ADD COLUMN IF NOT EXISTS credit_decided_at TIMESTAMPTZ;

-- Google/Facebook sign-in: a user row created this way still has a
-- password_hash (NOT NULL, so it gets a random unusable one at creation
-- time -- never actually checked against, since login for these users
-- goes through the oauth_provider/oauth_id pair below, not
-- POST /auth/login's password comparison). The partial unique index
-- means one Google account and one Facebook account can never both map
-- to two different rows for the same provider identity, while leaving
-- regular (non-OAuth) users' provider/id both NULL and unconstrained.
ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider TEXT; -- 'google' | 'facebook' | NULL
ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_id TEXT;       -- the provider's own user id (Google 'sub', Facebook 'id')
CREATE UNIQUE INDEX IF NOT EXISTS users_oauth_identity_idx ON users (oauth_provider, oauth_id) WHERE oauth_provider IS NOT NULL;

-- Token revocation (Phase 3, migration-plan.md item 3). Bumped on
-- password change so every previously-issued JWT for this user stops
-- being accepted (requireAuth compares the JWT's own tokenVersion claim
-- against this column on every request) without needing a separate
-- denylist table. Every existing token keeps working the moment this
-- column is added (DEFAULT 1, and every JWT-signing call site now signs
-- tokenVersion: user.token_version, so a freshly-issued token already
-- carries 1) -- this is purely additive, nothing existing breaks.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;

-- Audit trail for settlement/refund status changes (Phase 3,
-- migration-plan.md item 1). Append-only by convention (application
-- code only ever INSERTs here, never UPDATEs/DELETEs) -- addresses the
-- Tampering/Repudiation gap in docs/threat-model.md, where a mistaken
-- payout-status flip previously overwrote the prior state with no
-- record it had ever been different.
CREATE TABLE IF NOT EXISTS mkt_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID NOT NULL,
  actor_role  TEXT NOT NULL,
  entity_type TEXT NOT NULL, -- 'settlement' | 'refund'
  entity_id   UUID NOT NULL,
  action      TEXT NOT NULL, -- 'status_change' | 'created'
  before      JSONB,
  after       JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON mkt_audit_log(entity_type, entity_id);

-- Account verification (email + phone). DEFAULT true/true/'active' means
-- this is automatically retroactive for every existing account the
-- moment this column is added -- no separate grandfathering migration
-- needed, and no existing login (including every demo account this
-- whole build has relied on) is affected. New signups explicitly
-- override these to false/pending at INSERT time in authRouter.ts.
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active'; -- 'unverified' | 'partially_verified' | 'active'

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_verif_user ON email_verification_tokens(user_id);

CREATE TABLE IF NOT EXISTS phone_verification_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  attempts    INTEGER NOT NULL DEFAULT 0, -- wrong-code guesses against this specific code
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_phone_verif_user ON phone_verification_codes(user_id);

-- External supplier-catalog sync (CJdropshipping integration). Lets
-- mkt_supplier_products rows track which external source/product they
-- came from, so a repeat sync updates the same row (price/stock/etc.)
-- rather than creating a duplicate every time it runs. NULL for every
-- row created through the existing manual/admin-entry path -- this is
-- purely additive, nothing existing changes shape.
ALTER TABLE mkt_supplier_products ADD COLUMN IF NOT EXISTS external_source TEXT; -- e.g. 'cjdropshipping'
ALTER TABLE mkt_supplier_products ADD COLUMN IF NOT EXISTS external_id TEXT;     -- the source's own product id (CJ's `pid`)
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_products_external ON mkt_supplier_products(supplier_id, external_id) WHERE external_id IS NOT NULL;

-- Caches the CJdropshipping access/refresh token pair server-side --
-- getAccessToken is rate-limited to one call per 5 minutes on CJ's own
-- side (confirmed directly against their API docs before designing
-- this), so re-fetching on every request isn't just wasteful, it would
-- actively fail. Single row (id is always 'cj'); a real key-value store
-- would be overkill for one integration's one token pair.
CREATE TABLE IF NOT EXISTS cj_dropshipping_auth (
  id                       TEXT PRIMARY KEY DEFAULT 'cj',
  access_token             TEXT,
  access_token_expires_at  TIMESTAMPTZ,
  refresh_token            TEXT,
  refresh_token_expires_at TIMESTAMPTZ,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CJ's own variant ids for a CJ-sourced catalog item, captured at sync
-- time: [{ vid, key, priceUsd, image }]. Needed to place the real order
-- with CJ (createOrderV2 takes a vid per line). Admin/back-end only --
-- the seller listing's customer-facing variants carry an opaque hash of
-- the vid instead (see utils/cjVariants.ts), never the vid itself.
ALTER TABLE mkt_supplier_products ADD COLUMN IF NOT EXISTS external_variants JSONB NOT NULL DEFAULT '[]';

-- One row per customer order that contains CJ-sourced lines: the job that
-- places the matching order with CJ using the platform's own account, then
-- tracks it until delivery (services/cjFulfillment.ts). Admin-only -- CJ
-- order ids, CJ costs and error text never reach seller or customer APIs.
CREATE TABLE IF NOT EXISTS cj_fulfillments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           UUID NOT NULL UNIQUE REFERENCES mkt_orders(id),
  status             TEXT NOT NULL DEFAULT 'queued',
  -- queued | placing | placed | shipped | delivered | needs_attention | failed | cancelled
  attempts           INTEGER NOT NULL DEFAULT 0,
  next_attempt_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error         TEXT,
  cj_order_id        TEXT,
  cj_order_status    TEXT,     -- CJ's own: CREATED | UNPAID | UNSHIPPED | SHIPPED | DELIVERED | CANCELLED ...
  logistic_name      TEXT,     -- CJ's carrier name; customers see a white-labelled version
  tracking_number    TEXT,
  tracking_url       TEXT,
  cj_product_amount  NUMERIC(12,2), -- USD, what CJ charges for goods
  cj_postage_amount  NUMERIC(12,2), -- USD, what CJ charges for shipping
  cj_order_amount    NUMERIC(12,2), -- USD, total paid/owed to CJ
  pay_type           INTEGER,       -- 2 = paid from CJ balance automatically, 3 = created unpaid
  last_synced_at     TIMESTAMPTZ,
  alerted_at         TIMESTAMPTZ,
  placed_at          TIMESTAMPTZ,
  shipped_at         TIMESTAMPTZ,
  delivered_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cj_fulfillments_status ON cj_fulfillments(status);

-- CJ's quoted cheapest shipping (USD) to the pricing country for one unit,
-- captured at sync time so listing prices cover landed cost, not just goods.
ALTER TABLE mkt_supplier_products ADD COLUMN IF NOT EXISTS est_shipping_usd NUMERIC(12,2);

-- Background CJ catalogue sync (services/cjCatalog.ts). One row per job
-- kind; the worker advances `next_page` one page per tick until it passes
-- `end_page`, so a long sync survives restarts and never blocks a request.
CREATE TABLE IF NOT EXISTS cj_sync_jobs (
  id           TEXT PRIMARY KEY,                 -- 'catalog'
  status       TEXT NOT NULL DEFAULT 'idle',     -- idle | running | done | failed
  next_page    INTEGER NOT NULL DEFAULT 1,
  end_page     INTEGER NOT NULL DEFAULT 1,
  page_size    INTEGER NOT NULL DEFAULT 20,
  category_id  TEXT,                             -- CJ's category id filter, if any
  totals       JSONB NOT NULL DEFAULT '{}',
  total_available INTEGER,
  last_error   TEXT,
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One-off data changes that must run exactly once per database.
CREATE TABLE IF NOT EXISTS app_flags (
  key         TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  detail      TEXT
);

-- Every-category sweep state (services/cjCatalog.ts, job id 'sweep').
ALTER TABLE cj_sync_jobs ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'pages';
ALTER TABLE cj_sync_jobs ADD COLUMN IF NOT EXISTS plan JSONB NOT NULL DEFAULT '[]';
ALTER TABLE cj_sync_jobs ADD COLUMN IF NOT EXISTS plan_index INTEGER NOT NULL DEFAULT 0;

-- 'international' = shipped by the supplier straight to the customer: the
-- price includes delivery (no local delivery fee) and the promise is
-- 10-20 business days (utils/delivery.ts). NULL = dispatched locally.
ALTER TABLE mkt_products ADD COLUMN IF NOT EXISTS delivery_profile TEXT;
UPDATE mkt_products SET delivery_profile = 'international'
 WHERE delivery_profile IS NULL AND supplier_product_id IN (SELECT id FROM mkt_supplier_products WHERE external_source = 'cjdropshipping');

-- CJ product video references (productVideo, requested with features=enable_video).
ALTER TABLE mkt_supplier_products ADD COLUMN IF NOT EXISTS videos JSONB NOT NULL DEFAULT '[]';

-- Cheapest CJ shipping line to the pricing country, captured at sync, so
-- order placement can usually skip a (points-costing) freight quote.
ALTER TABLE mkt_supplier_products ADD COLUMN IF NOT EXISTS est_logistic_name TEXT;

-- ── BallylifeMORE subscriptions (services/subscriptions.ts) ──────────────
-- One row per subscription; a user may have many over time, at most one
-- not yet ended. Billing runs through a PayFast recurring subscription
-- (payfast_token); plan prices live in utils/plans.ts.
CREATE TABLE IF NOT EXISTS mkt_subscriptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               TEXT NOT NULL,
  plan                  TEXT NOT NULL,            -- standard | premium
  status                TEXT NOT NULL DEFAULT 'pending_payment',
  -- pending_payment (card not yet authorised) | trialing | active | past_due | cancelled | expired
  pending_plan          TEXT,                     -- a downgrade that starts next period
  trial_ends_at         TIMESTAMPTZ,
  current_period_start  TIMESTAMPTZ,
  current_period_end    TIMESTAMPTZ,
  cancel_at             TIMESTAMPTZ,              -- benefits end here after a cancellation
  cancelled_at          TIMESTAMPTZ,
  benefit_used          BOOLEAN NOT NULL DEFAULT false,   -- decides cooling-off refunds
  missed_periods        INTEGER NOT NULL DEFAULT 0,
  payfast_token         TEXT,
  commenced_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mkt_subscriptions_user ON mkt_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_mkt_subscriptions_status ON mkt_subscriptions(status);

-- Each subscription charge (and its refund), for payment history / invoices.
CREATE TABLE IF NOT EXISTS mkt_subscription_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES mkt_subscriptions(id),
  amount          NUMERIC(12,2) NOT NULL,
  status          TEXT NOT NULL,                  -- paid | refunded | failed
  plan            TEXT NOT NULL,
  period_start    TIMESTAMPTZ,
  period_end      TIMESTAMPTZ,
  processor_ref   TEXT,                           -- PayFast pf_payment_id
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_payments_ref ON mkt_subscription_payments(processor_ref) WHERE processor_ref IS NOT NULL;

-- Orders remember the membership they were placed under (discount applied,
-- priority support, returns window).
ALTER TABLE mkt_orders ADD COLUMN IF NOT EXISTS member_plan TEXT;
ALTER TABLE mkt_orders ADD COLUMN IF NOT EXISTS member_discount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE mkt_orders ADD COLUMN IF NOT EXISTS store_credit_applied NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE mkt_carts ADD COLUMN IF NOT EXISTS member_discount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE mkt_carts ADD COLUMN IF NOT EXISTS member_plan TEXT;

-- ── Store credit (business rebates, Ballylife.credit rewards) ────────────
-- Append-only ledger: positive = credit earned, negative = spent at
-- checkout. `reference` is unique so a rebate/reward/redemption can never
-- be recorded twice. Earned credit counts once available_at has passed and
-- until expires_at.
CREATE TABLE IF NOT EXISTS mkt_store_credit_ledger (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL,
  amount        NUMERIC(12,2) NOT NULL,
  source        TEXT NOT NULL,       -- business_rebate | credit_reward | order_redemption | order_reversal
  reference     TEXT NOT NULL UNIQUE,
  description   TEXT,
  available_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_store_credit_user ON mkt_store_credit_ledger(user_id);

-- ── Ballylife for Business ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mkt_business_accounts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              TEXT NOT NULL UNIQUE,
  company_name         TEXT NOT NULL,
  registration_number  TEXT,
  vat_number           TEXT,
  status               TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected | left
  decided_at           TIMESTAMPTZ,
  decision_note        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Japan used parts (UP-GARAGE, via an Apify actor) ────────────────────
-- Listings live in mkt_products like everything else, marked source =
-- 'upgarage' and keyed by the UP-GARAGE listing id so a refresh updates a
-- listing instead of duplicating it. `price` is always the final rand
-- resale price; price_breakdown records how it was reached (JPY price,
-- rate, forwarding, freight, duty, VAT, markup) so it can be audited and
-- recalculated when the rate or the admin's pricing settings change.
ALTER TABLE mkt_products ADD COLUMN IF NOT EXISTS source TEXT;                     -- NULL = CJ/seller product | 'upgarage'
ALTER TABLE mkt_products ADD COLUMN IF NOT EXISTS source_listing_id TEXT;
ALTER TABLE mkt_products ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE mkt_products ADD COLUMN IF NOT EXISTS source_keyword TEXT;             -- the refresh keyword that found it
ALTER TABLE mkt_products ADD COLUMN IF NOT EXISTS source_status TEXT;              -- listed | removed (gone from UP-GARAGE)
ALTER TABLE mkt_products ADD COLUMN IF NOT EXISTS source_last_seen_at TIMESTAMPTZ;
ALTER TABLE mkt_products ADD COLUMN IF NOT EXISTS source_shop TEXT;
ALTER TABLE mkt_products ADD COLUMN IF NOT EXISTS source_location TEXT;
ALTER TABLE mkt_products ADD COLUMN IF NOT EXISTS original_name TEXT;
ALTER TABLE mkt_products ADD COLUMN IF NOT EXISTS original_currency TEXT;
ALTER TABLE mkt_products ADD COLUMN IF NOT EXISTS original_price NUMERIC(14,2);          -- excl. Japanese consumption tax
ALTER TABLE mkt_products ADD COLUMN IF NOT EXISTS original_price_tax_incl NUMERIC(14,2); -- what UP-GARAGE charges
ALTER TABLE mkt_products ADD COLUMN IF NOT EXISTS condition_grade TEXT;
ALTER TABLE mkt_products ADD COLUMN IF NOT EXISTS parts_category TEXT;            -- freight class: wheels | tyres | seats | ...
ALTER TABLE mkt_products ADD COLUMN IF NOT EXISTS price_breakdown JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_source_listing ON mkt_products(source, source_listing_id) WHERE source_listing_id IS NOT NULL;

-- Admin-editable settings (one row): keywords to refresh and pricing.
CREATE TABLE IF NOT EXISTS jp_parts_settings (
  id          TEXT PRIMARY KEY DEFAULT 'default',
  settings    JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT
);

-- One row per keyword per refresh, so a blocked scraper or a changed
-- actor output is visible in the admin panel, not just the logs.
CREATE TABLE IF NOT EXISTS jp_parts_refresh_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword      TEXT NOT NULL,
  status       TEXT NOT NULL,          -- ok | failed | schema_changed | empty
  items        INTEGER NOT NULL DEFAULT 0,
  created      INTEGER NOT NULL DEFAULT 0,
  updated      INTEGER NOT NULL DEFAULT 0,
  removed      INTEGER NOT NULL DEFAULT 0,
  skipped      INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ
);

-- UP-GARAGE has no order API: a paid order line for a Japan part becomes a
-- task for staff to buy it and ship it via a forwarder.
CREATE TABLE IF NOT EXISTS jp_parts_fulfillments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         UUID NOT NULL REFERENCES mkt_orders(id),
  product_id       TEXT NOT NULL,
  product_name     TEXT,
  quantity         INTEGER NOT NULL DEFAULT 1,
  source_url       TEXT,
  status           TEXT NOT NULL DEFAULT 'to_buy', -- to_buy | bought | shipped | delivered | unavailable | cancelled
  purchase_ref     TEXT,
  forwarder        TEXT,
  tracking_number  TEXT,
  carrier          TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, product_id)
);

-- ── 1688 product research (Apify: sourabhbgp/1688-scraper) ──────────────
-- Research only: nothing here is shown to shoppers. An admin picks winners
-- and sends them to CJ as sourcing requests; once CJ has sourced a product
-- it's imported and sold like any other CJ product (CJ-only rule intact).
CREATE TABLE IF NOT EXISTS sourcing_1688_settings (
  id          TEXT PRIMARY KEY DEFAULT 'default',
  settings    JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT
);

CREATE TABLE IF NOT EXISTS sourcing_1688_offers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id            TEXT NOT NULL UNIQUE,
  title               TEXT NOT NULL,
  url                 TEXT,
  price_cny           NUMERIC(12,2) NOT NULL,
  price_range_cny     TEXT,
  moq                 INTEGER,
  unit                TEXT,
  stock               INTEGER,
  out_of_stock        BOOLEAN NOT NULL DEFAULT false,
  sold_count          INTEGER,
  repurchase_rate     NUMERIC(6,2),
  star_level          NUMERIC(4,1),
  supplier_name       TEXT,
  supplier_type       TEXT,
  supplier_years      INTEGER,
  location            TEXT,
  category_path       TEXT,
  images              JSONB NOT NULL DEFAULT '[]',
  video_url           TEXT,
  total_variants      INTEGER,
  supports_dropship   BOOLEAN,
  delivery_limit_days INTEGER,
  source_keyword      TEXT,
  product_class       TEXT,
  estimate            JSONB,
  status              TEXT NOT NULL DEFAULT 'new', -- new | shortlisted | dismissed | sent_to_cj | sourcing_failed | sourced | listed
  cj_sourcing_id      TEXT,
  cj_sourcing_status  TEXT,       -- CJ's text for the current state
  cj_fail_reason      TEXT,
  cj_product_id       TEXT,
  store_product_id    TEXT,       -- our mkt_products id once listed
  sent_to_cj_at       TIMESTAMPTZ,
  first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_1688_offers_status ON sourcing_1688_offers(status);

CREATE TABLE IF NOT EXISTS sourcing_1688_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  apify_run_id TEXT,
  keywords     JSONB NOT NULL DEFAULT '[]',
  status       TEXT NOT NULL,      -- ok | failed | schema_changed | empty
  items        INTEGER NOT NULL DEFAULT 0,
  created      INTEGER NOT NULL DEFAULT 0,
  updated      INTEGER NOT NULL DEFAULT 0,
  skipped      INTEGER NOT NULL DEFAULT 0,
  excluded     INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ
);

-- 1688 finds sold directly (bought through a China agent) until CJ sources them.
ALTER TABLE sourcing_1688_offers ADD COLUMN IF NOT EXISTS direct_product_id TEXT;  -- our mkt_products listing, bought via agent
ALTER TABLE sourcing_1688_offers ADD COLUMN IF NOT EXISTS variants JSONB NOT NULL DEFAULT '[]';
ALTER TABLE sourcing_1688_offers ADD COLUMN IF NOT EXISTS specs JSONB NOT NULL DEFAULT '[]';
ALTER TABLE sourcing_1688_offers ADD COLUMN IF NOT EXISTS selling_points JSONB NOT NULL DEFAULT '[]';
ALTER TABLE sourcing_1688_offers ADD COLUMN IF NOT EXISTS not_listed_reason TEXT;

-- The manual buy-and-forward queue serves Japan parts and 1688 agent orders alike.
ALTER TABLE jp_parts_fulfillments ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'upgarage'; -- upgarage | 1688
ALTER TABLE jp_parts_fulfillments ADD COLUMN IF NOT EXISTS variant_label TEXT;
ALTER TABLE jp_parts_fulfillments ADD COLUMN IF NOT EXISTS supplier_sku TEXT;

-- ── Super admin and account removal ─────────────────────────────────────
-- role 'super_admin': exactly one account, defined by SUPER_ADMIN_* env
-- vars (Railway) and re-applied at every boot. It alone adds and removes
-- managers and removes other accounts. "Removing" an account closes it
-- (account_status 'removed', every session revoked, a seller's store
-- suspended and products hidden) rather than deleting rows orders,
-- payouts and the audit trail still point at; it can be restored.
ALTER TABLE users ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS removed_by TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS removal_reason TEXT;
ALTER TABLE mkt_sellers ADD COLUMN IF NOT EXISTS suspended_by_removal BOOLEAN NOT NULL DEFAULT false;
