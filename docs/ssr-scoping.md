# Scoping: Server-Side Rendering / Crawler Visibility

Written as a decision document, not a build — this is deliberately *not*
implemented yet. Two of the three real options below touch either the
whole frontend's build/deploy model or an untested nginx config change in
front of a live site; picking one of those blind isn't something to do
without confirming the trade-off is worth it first.

## What's actually true right now (confirmed, not assumed)

- The frontend is a pure static build: `vite build` produces static
  files, served by nginx (`Dockerfile`, `nginx.conf.template`). There is
  no Node server running the frontend in production today.
- Per-page routing (shipped) means every product/category/page now has a
  real, unique URL. A crawler that executes JavaScript — Googlebot does —
  can already index all of them properly.
- What's still true: a crawler or tool that fetches a page *without*
  running JavaScript sees an empty `<div id="root"></div>` shell,
  regardless of the URL. This is the gap SSR would close.

## Option A — Full SSR framework (Next.js or Remix)

Rebuild the frontend on a framework that renders pages on a real Node
server, sending complete HTML on the first response.

- **What it actually means**: not a migration in the small sense — moving
  off Vite's static-build model to a framework with its own routing,
  data-fetching, and build conventions means most of `VinkMarketplace.tsx`'s
  view-based structure gets restructured into that framework's page model.
  The deployment model changes too: nginx-serving-static-files becomes a
  Node process serving requests, which changes the Dockerfile and how
  Railway runs this service.
- **Effort**: large — realistically weeks, not days, done properly and
  tested properly on a live app already handling real orders.
- **Payoff**: the complete fix. Every page, crawler or not, JS or not,
  gets real content immediately.
- **Risk**: highest of the three. A partial or rushed migration risks
  breaking checkout, auth, or the dashboards this whole build has spent
  most of its effort getting right.

## Option B — Dynamic rendering (serve crawlers a rendered snapshot, humans the real app)

Detect bot traffic (by user-agent) and serve those requests a
server-rendered HTML snapshot instead of the SPA shell; everyone else
gets the app exactly as it is today. This is the pattern Google itself
documented for years as the practical answer to this exact problem
(their own crawler renders JS fine now, but this still directly targets
the "AI tools and other crawlers that don't" half of the original ask).

- **What it actually means**: a rendering step (either a headless-browser
  render of the real app, or simpler hand-built HTML for product/category
  pages specifically, generated from the same database the sitemap now
  reads from) plus a routing rule that sends bot traffic there instead of
  the normal SPA response.
- **Where that routing rule would need to live**: nginx, in front of the
  static frontend — and this is the same honest constraint as the
  sitemap's cross-domain workaround: there's no way to test an nginx
  config change against this app's real behavior in the environment this
  was built in (no Docker daemon available), and a mistake in a
  user-agent-detection rule risks affecting real traffic, not just bots.
- **Effort**: medium. Smaller than Option A, doesn't touch the app's
  actual architecture — but the nginx piece specifically needs testing
  somewhere before production, which this session's environment can't do.
- **Payoff**: closes the real gap (non-JS crawlers) without touching how
  the live app is built or deployed for real users.

## Option C — Prerendered static snapshots for the highest-value pages only

Generate static HTML for the pages that matter most for discovery — the
homepage, category pages, and (via a build or scheduled job) the most
important products — without touching routing or nginx at all. Simplest
version: a scheduled backend job writes plain HTML files for these into
a location nginx already serves statically.

- **What it actually means**: does not cover the full catalog (~200,000
  products) — only worth doing for a curated subset, which means a real
  decision about *which* products get this treatment, not something to
  decide unilaterally.
- **Effort**: smallest of the three, and the only one with no nginx
  changes and no frontend architecture changes.
- **Payoff**: partial — the highest-traffic pages become fully crawlable
  by anything, JS or not; the long tail of products stays exactly as it
  is today (real URLs, Googlebot-indexable, but invisible to non-JS
  crawlers).

## Recommendation

Given the actual constraints here — a live app, real order flow already
built, and no way to test an nginx change safely in this environment —
**Option C is the one worth doing without a bigger conversation first**:
lowest risk, no architecture change, immediately achievable, and it
directly targets where the real value concentrates (homepage, categories,
featured/bestselling products) rather than trying to cover 200,000 pages
uniformly.

**Status: Option C is now built** (`scripts/prerender.mjs`, wired in as
a postbuild step after `vite build`). The top ~300 products by the same
"popular" sort the homepage uses get a real, static, crawlable HTML file
at their exact URL — no nginx changes, since nginx's existing SPA
fallback (`try_files $uri $uri/ /index.html`) already checks for a real
file at that path before falling back to the app shell. Fails soft: an
unreachable API or a single bad product logs a warning and the rest of
the build proceeds normally, never blocking a deploy over this.

Verified the script's actual logic (HTML escaping, error handling,
concurrency, reusing the real build's hashed script/CSS tags) against a
local mock server built to match the real API's exact response shape —
this sandbox's network is restricted to an allowlist of domains that
doesn't include the live Railway backend, so the true end-to-end path
(Docker build → live API → real product data) was not tested directly.
Worth checking the first real deploy's build logs to confirm the
`[prerender] Done: N product page(s) prerendered` line shows a real
count, not 0.

**Option B is the right long-term answer** if AI/non-JS crawler
visibility across the *entire* catalog genuinely matters for the
business — but it needs the nginx piece tested somewhere before
production, which is a real prerequisite, not a detail to skip.

**Option A is not recommended right now.** The payoff is completeness,
but the risk and effort are disproportionate to the actual problem
(most of it is already solved by real per-page URLs + Googlebot's own JS
rendering) — worth revisiting only if this app's traffic and team size
grow to where a framework-level rewrite is happening for other reasons
too, not for this reason alone.
