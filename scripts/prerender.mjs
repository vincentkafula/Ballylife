#!/usr/bin/env node
/**
 * Prerendering for the highest-value pages only (Option C in
 * docs/ssr-scoping.md) -- not full SSR. Runs as a postbuild step after
 * `vite build`, fetching real product data from the live API and
 * writing static HTML files directly into dist/, at the exact paths
 * nginx's existing SPA fallback (try_files $uri $uri/ /index.html)
 * already checks *before* falling back to the app shell -- a real file
 * at dist/product/<id>/index.html is served as-is, no nginx config
 * change required at all.
 *
 * This is NOT true hydration. The generated HTML has real, crawlable
 * content (name, description, price, image) sitting inside the same
 * #root div the real app mounts into -- when a human visits and the
 * real JS bundle loads, React replaces that content with the full
 * interactive page. A crawler or tool that never runs JavaScript sees
 * the real content and stops there, which is the actual goal.
 *
 * Deliberately fails soft: if the live API is unreachable during a
 * build (or ANY single product fails to prerender), this logs a
 * warning and continues rather than failing the whole build --
 * prerendering is an enhancement, not a requirement for the app to
 * work. The normal SPA already handles every URL correctly without it.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, "..", "dist");
const API_BASE = process.env.VITE_API_URL;
const PRODUCT_COUNT = Number(process.env.PRERENDER_PRODUCT_COUNT || 300);
const SITE_ORIGIN = "https://www.ballylife.com";

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function shortDescription(raw) {
  const clean = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= 155) return clean;
  return clean.slice(0, 155).replace(/\s+\S*$/, "") + "…";
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function main() {
  if (!API_BASE) {
    console.log("[prerender] VITE_API_URL not set -- skipping prerendering (the app itself doesn't need this to work).");
    return;
  }
  if (!fs.existsSync(DIST_DIR)) {
    console.log("[prerender] dist/ doesn't exist -- run `vite build` first. Skipping.");
    return;
  }

  const shellPath = path.join(DIST_DIR, "index.html");
  const shell = fs.readFileSync(shellPath, "utf-8");

  // Pull out the exact script/link/manifest tags vite generated (hashed
  // filenames change every build) so the real app loads correctly on
  // top of the prerendered content -- never hand-write or guess these.
  const headExtras = [...shell.matchAll(/<script type="module"[^>]*><\/script>|<link rel="stylesheet"[^>]*>|<link rel="modulepreload"[^>]*>/g)]
    .map((m) => m[0]).join("\n    ");
  const bodyExtras = [...shell.matchAll(/<link rel="manifest"[^>]*>|<script id="vite-plugin-pwa:register-sw"[^>]*><\/script>/g)]
    .map((m) => m[0]).join("");

  function renderPage({ title, description, ogImage, canonicalPath, bodyHtml }) {
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#14110D" />
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${SITE_ORIGIN}${canonicalPath}" />

    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Ballylife" />
    <meta property="og:url" content="${SITE_ORIGIN}${canonicalPath}" />
    ${ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}" />` : ""}

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />

    <title>${escapeHtml(title)}</title>
    <link rel="icon" type="image/png" href="/favicon.png" />
    ${headExtras}
  </head>
  <body>
    <div id="root">${bodyHtml}</div>
    ${bodyExtras}
  </body>
</html>
`;
  }

  function writeStaticPage(urlPath, html) {
    const dir = path.join(DIST_DIR, urlPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), html, "utf-8");
  }

  let successCount = 0;
  let failCount = 0;

  // The top N products by the same "popular" sort the homepage itself
  // uses -- these are the pages actually worth the build-time cost of
  // prerendering, not an attempt to cover the full ~200,000-product
  // catalog (see docs/ssr-scoping.md on why that's a separate, bigger
  // decision, not something to do by default here).
  let productIds = [];
  try {
    const listing = await fetchJson(`${API_BASE}/api/marketplace/products?sort=popular&limit=${PRODUCT_COUNT}`);
    productIds = (listing.data ?? []).map((p) => p.id).filter(Boolean);
  } catch (err) {
    console.warn(`[prerender] Couldn't fetch the product list -- skipping all product prerendering: ${err.message}`);
  }

  async function prerenderOne(id) {
    try {
      const detail = await fetchJson(`${API_BASE}/api/marketplace/products/${id}`);
      const product = detail.data?.product;
      if (!product) throw new Error("no product in response");
      const name = product.name ?? "Product";
      const description = shortDescription(product.description ?? product.shortDescription ?? "");
      const image = Array.isArray(product.images) ? product.images[0] : undefined;
      const price = product.price != null ? `${product.currency ?? "ZAR"} ${product.price}` : "";

      const bodyHtml = `
      <main>
        <h1>${escapeHtml(name)}</h1>
        ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(name)}" />` : ""}
        ${price ? `<p>${escapeHtml(price)}</p>` : ""}
        <p>${escapeHtml(description)}</p>
      </main>`;

      writeStaticPage(`product/${id}`, renderPage({
        title: `${name} — Ballylife`,
        description: description || `${name} — available on Ballylife.`,
        ogImage: image,
        canonicalPath: `/product/${id}`,
        bodyHtml,
      }));
      successCount++;
    } catch (err) {
      failCount++;
      // One bad product shouldn't stop the rest -- logged, not fatal.
      console.warn(`[prerender] Skipped product ${id}: ${err.message}`);
    }
  }

  // A handful of products in flight at once rather than one-at-a-time --
  // 300 sequential round-trips to the live API would add real minutes to
  // every single deploy; this keeps that cost reasonable without
  // hammering the API with all 300 simultaneously.
  const CONCURRENCY = 10;
  for (let i = 0; i < productIds.length; i += CONCURRENCY) {
    await Promise.all(productIds.slice(i, i + CONCURRENCY).map(prerenderOne));
  }

  console.log(`[prerender] Done: ${successCount} product page(s) prerendered${failCount ? `, ${failCount} skipped` : ""}.`);
}

main().catch((err) => {
  // Never fail the build over this -- see the file-level comment.
  console.warn(`[prerender] Prerendering failed entirely, continuing without it: ${err.message}`);
});
