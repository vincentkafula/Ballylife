/**
 * Sealed references: small encrypted, tamper-proof tokens that carry
 * server-only details (which supplier, the supplier's product id, a supplier
 * image URL) through the seller's browser without the browser being able
 * to read them. Used for sourcing results and their photos, so sellers
 * never see a supplier name, id or link -- not even in the network tab.
 *
 * AES-256-GCM (utils/secureData key), base64url so it's safe in URLs.
 * A token can't be forged or edited: anything tampered with fails to open.
 */
import { encryptBuffer, decryptBuffer } from "./secureData";

export function seal(value: unknown): string {
  return encryptBuffer(Buffer.from(JSON.stringify(value), "utf8")).toString("base64url");
}

export function unseal<T = unknown>(token: string): T | null {
  if (typeof token !== "string" || token.length < 40 || token.length > 4000 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  try { return JSON.parse(decryptBuffer(Buffer.from(token, "base64url")).toString("utf8")) as T; }
  catch { return null; }
}
