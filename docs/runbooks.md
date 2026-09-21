# Runbooks

Scoped to Ballylife's actual architecture and actual known gaps (see
`docs/threat-model.md` and `docs/production-readiness.md`), not generic
templates. Each one assumes you're the person running this alone or with
a small team, not paging a 24/7 on-call rotation.

## "Payments aren't confirming"

Given PayFast isn't active in production yet (see README — merchant
credentials unset), this is currently expected behavior, not an
incident: every order falls back to the `manual` processor and stays
`pending_payment` until someone manually confirms it via the admin
panel. Once PayFast credentials are set, if orders still aren't
confirming:

1. Check `GET /health` — confirm `dbReachable: true` first; a payment
   can't confirm if the backend can't write to the database at all.
2. Check the backend's deploy logs (Railway dashboard → ballylife-backend
   → deployment logs) for `payfast.itn_signature_mismatch` or
   `payfast.itn_not_confirmed_by_payfast` (structured JSON log lines,
   Phase 6) — these tell you which of the two verification layers
   rejected the webhook.
3. If `itn_signature_mismatch`: the passphrase set in
   `PAYFAST_PASSPHRASE` doesn't match what's configured on the PayFast
   merchant dashboard's Integration Settings. They must match exactly.
4. If `itn_not_confirmed_by_payfast`: PayFast's own servers didn't
   validate the callback — check `PAYFAST_MODE` (sandbox vs live)
   matches which merchant ID/key pair you're using; a sandbox key
   against `PAYFAST_MODE=live` (or vice versa) fails here every time.
5. Check `mkt_pay_transactions` directly for the order — a `submitted`
   status stuck for more than a few minutes with no `confirmed`/`failed`
   transition means PayFast's webhook never arrived at all; check
   `MARKETPLACE_API_PUBLIC_URL` is a real, publicly reachable HTTPS URL
   (PayFast can't reach `localhost` or an internal Railway domain).

## "A deploy broke something"

1. Railway dashboard → the affected service → Deployments tab → find the
   last known-good deployment → **Redeploy** it. This is the fastest
   rollback path; it doesn't require a git revert first.
2. Once traffic is stable again, `git revert` the bad commit properly so
   the next real deploy doesn't reintroduce it.
3. If the issue is a migration that partially applied (schema.sql or a
   gated migrate.ts function) — check the deploy logs for which
   migration step logged an error. Every migration in this codebase is
   written to be safely re-runnable (see any function in
   `server/src/db/migrate.ts` for the pattern: check first, skip if
   already done, never assume a clean starting state) — a redeploy of
   the same or a fixed version should pick up correctly rather than
   needing manual schema surgery.

## "The database needs to be restored"

**Read this now, not during the incident** — as of Phase 6, no backup
schedule is enabled yet (see `docs/production-readiness.md`; this is the
single most important thing to fix before treating this runbook as
sufficient). Once backups are enabled:

1. Volume backups (daily/weekly/monthly snapshots): Railway dashboard →
   Postgres service → Backups tab → find the backup from just before
   the incident → Restore. This replaces the current volume; expect a
   few minutes of downtime while it swaps.
2. Point-in-time recovery (if enabled): `railway postgres pitr restore`
   to a specific timestamp — this creates a **new sibling service**,
   not an in-place restore, so you'll need to repoint `DATABASE_URL` on
   the backend service to the new one once you've confirmed it has the
   right data.
3. Either way: **verify the restored data before repointing production
   traffic at it.** An unverified restore is exactly the failure mode
   Railway's own backup documentation warns about.

## "JWT secret needs to be rotated" (compromise, or just routine hygiene)

1. Generate a new secret: `openssl rand -base64 48`.
2. Set `MARKETPLACE_JWT_SECRET` to the new value in Railway's backend
   service variables, then redeploy.
3. **Every currently-issued token becomes invalid the moment this
   deploys** — every signed-in user, on every role, gets logged out
   simultaneously. This is different from the `token_version`
   revocation added in Phase 3 (which invalidates one user's tokens);
   rotating the secret invalidates everyone's at once. Only do this for
   an actual suspected compromise or planned rotation, not casually.
4. If NODE_ENV=production and this variable is ever accidentally
   removed rather than rotated, the backend will refuse to boot at all
   (Phase 1's fail-fast behavior) rather than silently falling back to
   an insecure default — that's a deploy failure to fix immediately,
   not a security incident to investigate.
