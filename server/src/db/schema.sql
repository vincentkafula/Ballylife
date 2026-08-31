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
