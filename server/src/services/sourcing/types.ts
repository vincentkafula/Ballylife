/**
 * The supplier adapter contract. Every supplier (AliExpress, CJ -- which
 * also covers 1688 products, sourced by CJ -- and any future one) is one
 * adapter file implementing SupplierAdapter, registered in adapters/index.ts.
 * Nothing outside services/sourcing talks to a supplier directly.
 *
 * Raw types (SupplierHit, SupplierProduct) are server-only: they contain the
 * supplier's ids, prices and image URLs. What sellers get is the normalised,
 * white-labelled Sourced* shape from normalize.ts.
 */

export interface SourcingQuery {
  keyword: string;
  category?: string;      // free text; adapters that support categories use it
  minPriceZar?: number;   // filters apply to Ballylife's base cost in rand
  maxPriceZar?: number;
  page?: number;
}

/** One search result, as the supplier describes it (server-only). */
export interface SupplierHit {
  externalId: string;
  title: string;
  cost: number;           // unit cost before shipping
  currency: string;       // e.g. USD
  image: string | null;   // supplier CDN URL
  orders: number | null;  // units sold, when the supplier reports it
  rating: number | null;  // out of 5
}

export interface SupplierVariant {
  externalSku: string;
  label: string;          // e.g. "Black / XL"
  cost: number;
  stock: number;
  image?: string;
}

/** Full product detail, as the supplier describes it (server-only). */
export interface SupplierProduct {
  externalId: string;
  title: string;
  description: string;
  images: string[];
  variants: SupplierVariant[];
  currency: string;
  category: string | null;
  available: boolean;
}

export interface SupplierShipping {
  cost: number;
  currency: string;
  minDays: number | null;
  maxDays: number | null;
}

export interface SupplierOrderRequest {
  reference: string;       // Ballylife order number
  lines: { externalId: string; externalSku: string; quantity: number }[];
  shipTo: { name: string; phone: string; line1: string; line2?: string; city: string; province?: string; postalCode: string; country: "ZA" };
}

export interface SupplierAdapter {
  /** Internal key, e.g. "aliexpress". Never shown to sellers or buyers. */
  key: string;
  /** Keys/secrets present (Railway variables) and connected. */
  isConfigured(): boolean | Promise<boolean>;
  /** Estimated USD cost of one call, per endpoint (for the spend ledger). */
  costPerCall: Partial<Record<SourcingEndpoint, number>>;
  search(q: SourcingQuery): Promise<SupplierHit[]>;
  getProduct(externalId: string): Promise<SupplierProduct>;
  getShipping(externalId: string, externalSku?: string): Promise<SupplierShipping | null>;
  placeOrder(req: SupplierOrderRequest): Promise<{ supplierOrderIds: string[] }>;
  trackOrder(supplierOrderId: string): Promise<{ status: string; trackingNumber: string | null; carrier: string | null }>;
}

export type SourcingEndpoint = "search" | "getProduct" | "getShipping" | "placeOrder" | "trackOrder";

/** Thrown for things a supplier doesn't do (yet) through the adapter layer. */
export class AdapterUnsupportedError extends Error {}
