# Incident Response Plan

Scaled to what Ballylife actually is right now: a solo-founder /
small-team project on Railway, not an enterprise with a SOC and a
24/7 on-call rotation. This is a real plan for that scale, not a
enterprise template with the serial numbers filed off.

## Severity levels

**SEV1 — the site is down, or money is at risk.** Backend or frontend
fully unreachable; a payment is confirming incorrectly (charging without
delivering, or vice versa); a security compromise is suspected (leaked
JWT secret, unauthorized admin access). Act immediately, don't wait for
a convenient time.

**SEV2 — a real feature is broken, but the site is otherwise usable.**
Checkout works but order tracking doesn't; one seller's dashboard is
broken but the storefront is fine; the audit log isn't recording
correctly. Fix within the same day if possible.

**SEV3 — everything else.** A cosmetic bug, a slow endpoint, a
non-critical admin report failing. Normal backlog.

## First response (SEV1)

1. **Check `/health` on the backend** — `{status, db, dbReachable,
   uptimeSeconds}`. This alone tells you whether the process is up and
   whether it can reach the database, which narrows most SEV1s
   immediately.
2. **Check Railway's deployment status** for both services — is the
   latest deploy actually `SUCCESS`, or stuck/failed?
3. **If a recent deploy is the likely cause**: roll back via Railway's
   redeploy-previous-deployment button first, investigate after — see
   `docs/runbooks.md`'s "A deploy broke something." Restoring service
   comes before understanding root cause.
4. **If it's a suspected security compromise** (not just a bug): rotate
   `MARKETPLACE_JWT_SECRET` immediately (see `docs/runbooks.md`) even
   before you've fully understood the scope — this logs out every
   session at once, which is the right default reaction to "someone
   might have a valid token they shouldn't."

## Communication

At this scale, "communication" mostly means: if customers are actually
affected (checkout down, payments failing), post something on whatever
channel customers would see (site banner if you can ship one fast, or
direct outreach if the affected group is small enough to know
individually). There's no formal status page or support queue built
into this project yet — that's a real gap if traffic grows, not
something this document can invent a process for that doesn't exist.

## After the incident

1. Write down what happened, when, and what fixed it — even three
   sentences in a commit message or a dated file is enough at this
   scale. The runbooks in `docs/runbooks.md` should get updated if the
   incident revealed a gap in them.
2. If the root cause maps to something in `docs/threat-model.md` or
   `docs/migration-plan.md` that was already a known, documented gap —
   that's a signal to actually prioritize it, not a new discovery.
3. If it revealed something genuinely new, add it to both of those
   documents so it's tracked the same way everything else here is,
   rather than living only in memory of what happened.

## What this plan deliberately doesn't include

A named on-call rotation, a paging system (PagerDuty/Opsgenie), a formal
RTO/RPO commitment, and a legal/PR escalation path — these are real
things a larger team needs and this project doesn't have the scale to
support yet. Adding them now would be process theater, not
preparedness. Revisit this document when there's a team large enough
for "who gets paged at 3am" to be a real question.
