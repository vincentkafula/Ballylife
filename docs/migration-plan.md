# Migration Plan: Current State → Target

Every item below is additive (new table, new column, new middleware) — nothing
here requires touching or rewriting a working table or route. Ordered by
value/effort, not by the phase numbering in the original brief, since several
of these are small enough to fold into whichever phase is already touching
that area.

## 1. Settlement/refund audit trail (addresses the Tampering/Repudiation gaps in `threat-model.md`)

Add one new table, don't touch `mkt_order_line_settlements` or `mkt_order_refunds`:

```sql
CREATE TABLE IF NOT EXISTS mkt_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID NOT NULL,           -- users.id of whoever made the change
  actor_role  TEXT NOT NULL,
  entity_type TEXT NOT NULL,           -- 'settlement' | 'refund' | 'order_status' | ...
  entity_id   UUID NOT NULL,
  action      TEXT NOT NULL,           -- 'status_change' | 'created' | ...
  before      JSONB,                   -- snapshot of the changed fields before
  after       JSONB,                   -- snapshot of the changed fields after
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON mkt_audit_log(entity_type, entity_id);
```

Application change: wherever `PATCH /admin/settlements/:id` and
`POST /admin/orders/:id/refund` currently do their `UPDATE`, add one more
`INSERT INTO mkt_audit_log`. No existing query changes shape. Never `UPDATE`
or `DELETE` a row in this table from application code — enforce that with a
Postgres trigger or just discipline + a code-review checklist item; a full
row-level-security lockdown is more machinery than this needs yet.

**Effort**: small. **Risk**: none to existing behavior (pure addition).

## 2. PayFast IP-allowlist (closes the last documented layer)

Add a small allowlist check in `payfastProcessor.ts` before (not instead of)
the existing signature + confirm-round-trip checks. PayFast publishes their
IP ranges — `TODO(verify)`: pull the current list from PayFast's own
integration docs at implementation time rather than hardcoding ranges from
memory here, since IP ranges are exactly the kind of thing that goes stale
silently.

**Effort**: small. **Risk**: low, as long as the ranges are kept current —
a stale allowlist would start rejecting real PayFast traffic, so this needs
a "how to update" note in the README, not just the code.

## 3. Token revocation (closes the Elevation-of-Privilege gap on role changes)

Add one column:
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;
```
Include `tokenVersion` in the JWT payload at sign-time. `requireAuth` checks
it against the current `users.token_version` on each request (one extra
indexed lookup — acceptable at current traffic, revisit with a cache if it
ever isn't). Incrementing `token_version` (on role change, password change,
or a future "log out everywhere" action) instantly invalidates every
previously-issued token for that user, without needing a separate
denylist table.

**Effort**: small-medium (touches `requireAuth`, adds one query per
authenticated request). **Risk**: low — additive column, default value
means every existing token still validates until the column is actually
used to invalidate something.

## 4. Reconciliation check (closes the "nothing enforces the invariant" gap)

A scheduled job (not built yet — this repo has no background job runner,
see `docs/architecture.md`'s "what this is not yet" section) that, for each
order, checks: sum of `confirmed` `mkt_pay_transactions.amount` == 
`mkt_orders.total_amount` == sum of that order's
`mkt_order_line_settlements.gross_amount`, and writes a `mkt_fraud_flags`
row (that table already exists and already has a `rule`/`severity`/
`subject_type` shape built for exactly this) when they don't match.

**Prerequisite**: this genuinely needs a job runner or at minimum a Railway
cron service — it's the one item on this list that isn't just "add a
column." Reasonable to defer to whichever phase adds background jobs for
other reasons too (e.g. retrying a failed webhook), rather than standing up
infrastructure for this alone.

**Effort**: medium (new infrastructure). **Risk**: none to existing
behavior — a reconciliation job only reads and flags, never writes to
orders/settlements directly.

## 5. `UNIQUE(order_id, product_id)` on `mkt_order_line_settlements`

```sql
ALTER TABLE mkt_order_line_settlements
  ADD CONSTRAINT uq_settlement_order_product UNIQUE (order_id, product_id);
```

**Effort**: trivial. **Risk**: this is the one item here that could
theoretically fail to apply if duplicate rows already exist in production —
`TODO(verify)`: run the check query below before adding the constraint, not
after:
```sql
SELECT order_id, product_id, COUNT(*) FROM mkt_order_line_settlements
GROUP BY order_id, product_id HAVING COUNT(*) > 1;
```
If that returns any rows, resolve them manually first (this is exactly the
kind of check Phase 0's audit methodology — verify before changing,
evidence not guesses — should keep applying going forward, not just during
the audit phases themselves).

## What's deliberately not on this list

Full double-entry bookkeeping, KYC/AML integration, and a formal
maker-checker four-eyes approval flow are not on this plan. Per Phase 0's
own findings: this is a marketplace settling through a licensed PSP, not a
bank holding customer funds directly, and the original brief's banking-
specific requirements don't map 1:1 here (see the note at the top of the
Phase 0 audit). If that assessment is wrong for reasons specific to your
regulatory situation, that's a conversation to have before scoping this
plan further, not something to guess at in a migration doc.
