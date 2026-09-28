/**
 * The supplier registry. To add a supplier: write one adapter file
 * implementing SupplierAdapter and add it to this list -- nothing else in
 * the app changes. It can then be switched on/off from the Manager
 * dashboard (sourcing_suppliers).
 *
 * 1688 has no adapter of its own on purpose: 1688 products are reached
 * through CJ (official), not by scraping 1688.
 */
import type { SupplierAdapter } from "../types";
import { aliexpressAdapter } from "./aliexpress";
import { cjAdapter } from "./cj";

export const ADAPTERS: SupplierAdapter[] = [aliexpressAdapter, cjAdapter];

export function adapterFor(key: string): SupplierAdapter | undefined {
  return ADAPTERS.find(a => a.key === key);
}

/** For tests: replace the registry. */
export function _setAdaptersForTests(list: SupplierAdapter[]) { ADAPTERS.splice(0, ADAPTERS.length, ...list); }
