# Production Readiness (Phase 6)

Every claim below was checked directly (Railway's own config API, Railway's
own official docs, or this repo's actual code) before being written here.
Where something needed the account owner to act rather than being fixable
in code, that's stated plainly rather than glossed over.

## Backup / disaster recovery — real gap found, not assumed

Checked Ballylife's actual production Postgres service configuration
directly (Railway's `describe-service`) before writing anything here.
**Result: no backup protection of any kind is currently enabled.** The
service config has no backup schedule, no PITR, nothing beyond the
underlying volume Railway itself manages operationally (which is
infrastructure durability, not a *recoverable* backup — it doesn't
protect against a bad migration, an accidental `DELETE`, or a mistake in
this app's own code).

Verified against Railway's own official documentation
(docs.railway.com/guides/postgres-backups-restores) that three real
layers exist, but **all three are opt-in** — nothing here is automatic
until someone turns it on:

| Layer | What it protects against | Restores to |
|---|---|---|
| Volume backups (daily/weekly/monthly) | Bad deploys, data mistakes | The same service |
| Point-in-time recovery (continuous WAL) | "Recover to the moment just before that DROP TABLE" | A new sibling Postgres service, any timestamp in the window |
| Logical dumps (`pg_dump`) | Offsite copies, migrations, restore drills | Anywhere |

**Why this wasn't fixed directly**: the tools available in this session
can read and modify service configuration, environment variables, and
deployments, but volume backup schedules and PITR are configured through
Railway's dashboard (service → Backups tab) or the `railway postgres
pitr` CLI command group — neither is reachable through what's available
here. This needs you to act, not a code change.

**What to actually do** (5 minutes, no downtime):
1. Railway dashboard → Postgres service → **Backups** tab → enable a
   daily schedule at minimum.
2. Optionally, `railway postgres pitr enable` for continuous WAL
   archiving if point-in-time recovery (not just daily snapshots)
   matters at your data-change rate.
3. Run one manual logical dump (`pg_dump`) now and store it somewhere
   outside Railway (even just downloaded locally) as an immediate,
   zero-setup safety net while the scheduled layers take effect — and to
   actually test that a restore works, per Railway's own guidance that
   an unverified backup isn't a trustworthy one.

## Infrastructure as Code — honest assessment, not a build

Researched before choosing an approach, since defaulting to "write some
Terraform" without checking would have meant recommending a path that
doesn't actually exist in a trustworthy form for this platform.

- **No official Terraform provider for Railway exists.** Only a
  community-maintained one (`terraform-community-providers/railway`) —
  usable, but an unofficial, community-maintained dependency in your
  deploy pipeline is a real risk to accept knowingly, not a default to
  reach for.
- **Railway has its own native IaC** (`.railway/railway.ts`, TypeScript-
  only), but Railway's own release notes explicitly call it
  "intentionally experimental" with "rough edges" as of this writing.
- Railway's own stated product philosophy (docs.railway.com/platform/
  philosophy) is deliberately light on required config — "take what you
  need, leave what you don't" — which is consistent with how this
  project has actually been run (manual dashboard/CLI configuration,
  documented in `docs/architecture.md` and both `.env.example` files
  from Phase 1) rather than a gap introduced by skipping IaC.

**Recommendation**: don't adopt the unofficial Terraform provider for
production. If declarative infra-as-code becomes valuable at a larger
team size, Railway's own native IaC is the one to watch (first-party,
actively developed) — try it in a non-production environment first
given its own "experimental" label, not go straight to using it for the
real project.

## Observability

No APM, metrics, or tracing exists — same situation as Google/Facebook
sign-in and image search earlier in this project: a real integration
(Sentry, Datadog, OpenTelemetry, etc.) needs an external account and API
key only you can provision, not something to bolt on unilaterally
(choice of provider is a real decision, and most have real costs at
scale). What Railway already provides without any setup: it captures
every `console.log`/`console.error` from both services automatically,
viewable in the dashboard's deployment logs — a genuine, if basic, first
layer, not nothing.

What's addressed in this phase without needing external credentials:
structured logging (see below) and an enhanced health check, so *when*
you do add a real APM tool, the logs it ingests are already structured
rather than needing a second pass.

## Load / performance testing

A load-test script is added (`server/scripts/loadtest.mjs`) covering the
two highest-traffic-shape endpoints: `GET /api/marketplace/products`
(the catalog, unauthenticated, highest expected volume) and `POST /api/
marketplace/orders` (the money-moving path, now rate-limited at 30/min
per IP as of Phase 3 -- the script respects that rather than being
surprised by 429s).

**This was not run against production.** Two real constraints: this
session's sandbox has no Docker daemon (can't run the docker-compose
stack from Phase 1 to test locally either), and hammering the live
Railway service with concurrent load costs real money (Railway bills by
usage) and could affect real traffic if any exists — not something to
do without explicit, informed go-ahead. The script is ready to run
either against a local `docker compose up` stack, or against production
with your explicit confirmation of how much load and for how long.
