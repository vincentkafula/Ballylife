/**
 * Maps this app's internal `View` state to real, unique URLs and back.
 * Deliberately a plain lookup table, not React-Router <Route> elements --
 * VinkMarketplace.tsx's existing conditional rendering by `view` state
 * stays exactly as it was (lower risk than rewriting a 2000+ line
 * component's rendering logic); this module is the translation layer
 * that makes the URL bar reflect that state and vice versa, so pages
 * are real, shareable, indexable, and survive a refresh or back/forward.
 *
 * Any view not listed here (checkout, orders, account, and the seven
 * role-dashboard views) still gets a real URL via the DEFAULT_PATHS
 * fallback below -- they just don't carry a product id or other param,
 * since none of them need one.
 */

export type MarketplaceView =
  | "home" | "catalog" | "product" | "cart" | "checkout" | "orders" | "wishlist"
  | "seller" | "supplier" | "authority" | "shipping" | "credit" | "admin" | "account"
  | "trackOrder" | "contactPage" | "termsPage" | "humanRightsPage" | "disclosurePage"
  | "speakUpPage" | "advertisingPage" | "creditRewardsPage" | "businessTermsPage"
  | "privacyPolicyPage" | "returnsPolicyPage" | "ballylifeMorePage" | "aboutUsPage" | "morePlans";

const VIEW_TO_PATH: Record<MarketplaceView, string> = {
  home: "/",
  catalog: "/catalog",
  product: "/product", // real path is /product/:id -- see pathForView
  cart: "/cart",
  checkout: "/checkout",
  orders: "/orders",
  wishlist: "/wishlist",
  seller: "/seller",
  supplier: "/supplier",
  authority: "/revenue-authority",
  shipping: "/shipping",
  credit: "/credit-provider",
  admin: "/admin",
  account: "/account",
  trackOrder: "/track-order",
  contactPage: "/contact",
  termsPage: "/terms",
  humanRightsPage: "/human-rights",
  disclosurePage: "/responsible-disclosure",
  speakUpPage: "/speak-up",
  advertisingPage: "/advertising-practice",
  creditRewardsPage: "/ballylife-credit",
  businessTermsPage: "/business-terms",
  privacyPolicyPage: "/privacy-policy",
  returnsPolicyPage: "/returns-policy",
  ballylifeMorePage: "/ballylife-more",
  morePlans: "/more",
  aboutUsPage: "/about-us",
};

// Reverse lookup, built once from the table above so the two directions
// can never drift out of sync with each other.
const PATH_TO_VIEW: Record<string, MarketplaceView> = Object.fromEntries(
  Object.entries(VIEW_TO_PATH)
    .filter(([view]) => view !== "product") // /product/:id handled separately below
    .map(([view, path]) => [path, view as MarketplaceView])
);

/** The URL for a given view (+ product id, when the view is "product"). */
export function pathForView(view: MarketplaceView, productId?: string): string {
  if (view === "product") return productId ? `/product/${encodeURIComponent(productId)}` : "/catalog";
  return VIEW_TO_PATH[view] ?? "/";
}

/**
 * The view (+ product id, when applicable) for a given URL path. Falls
 * back to "home" for anything unrecognized (including a stale/removed
 * product link) rather than a blank or broken screen.
 */
export function viewForPath(pathname: string): { view: MarketplaceView; productId?: string } {
  const productMatch = pathname.match(/^\/product\/([^/]+)\/?$/);
  if (productMatch) return { view: "product", productId: decodeURIComponent(productMatch[1]) };
  const view = PATH_TO_VIEW[pathname];
  return view ? { view } : { view: "home" };
}

/** A short, human title suffix per view, for document.title. */
export const TITLE_FOR_VIEW: Partial<Record<MarketplaceView, string>> = {
  catalog: "Shop",
  cart: "Your Cart",
  checkout: "Checkout",
  orders: "Your Orders",
  wishlist: "Wishlist",
  account: "My Account",
  trackOrder: "Track Order",
  contactPage: "Contact Us",
  termsPage: "Platform Terms",
  humanRightsPage: "Human Rights Statement",
  disclosurePage: "Responsible Disclosure Policy",
  speakUpPage: "Speak Up Process",
  advertisingPage: "Code of Advertising Practice",
  creditRewardsPage: "Ballylife.credit",
  businessTermsPage: "Ballylife for Business",
  privacyPolicyPage: "Privacy Policy",
  returnsPolicyPage: "Returns Policy",
  ballylifeMorePage: "BallylifeMORE",
  morePlans: "BallylifeMORE plans",
  aboutUsPage: "About Us",
};

/**
 * Sets document.title and the <meta name="description"> tag together --
 * the two pieces that actually show up in a search result snippet or a
 * shared-link preview. Falls back to the default meta description
 * (baked into index.html at build time) when no description is given,
 * rather than leaving a stale one from whatever page was last visited.
 */
const DEFAULT_DESCRIPTION = "Ballylife — a multi-vendor online marketplace with a broad catalog spanning electronics, fashion, home, health and beauty, and more, serving South Africa and expanding across Africa.";

export function setPageMeta(title: string, description?: string): void {
  document.title = title;
  const metaTag = document.querySelector('meta[name="description"]');
  if (metaTag) metaTag.setAttribute("content", description ?? DEFAULT_DESCRIPTION);
}
