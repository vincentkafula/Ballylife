/**
 * Encryption for personal data we must keep but never want readable in
 * the database or storage: payout bank details, ID numbers and uploaded
 * identity documents (POPIA). AES-256-GCM, so tampering is detected.
 *
 * The key comes from DATA_ENCRYPTION_KEY (recommended: set a long random
 * value on Railway and never change it), falling back to the JWT secret.
 * Changing the key makes previously stored data unreadable.
 */
import crypto from "crypto";

function key(): Buffer {
  const secret = process.env.DATA_ENCRYPTION_KEY || process.env.MARKETPLACE_JWT_SECRET || "ballylife-dev-secret-change-in-prod";
  return crypto.createHash("sha256").update(`${secret}:personal-data`).digest();
}

export function encryptBuffer(plain: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]); // 12 + 16 + data
}

export function decryptBuffer(blob: Buffer): Buffer {
  const d = crypto.createDecipheriv("aes-256-gcm", key(), blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
}

export const encryptText = (plain: string): string => encryptBuffer(Buffer.from(plain, "utf8")).toString("base64");
export const decryptText = (blob: string): string => decryptBuffer(Buffer.from(blob, "base64")).toString("utf8");

/** "•••• 4821" -- enough for a person to recognise, not enough to misuse. */
export const maskTail = (value: string, keep = 4): string => `•••• ${value.replace(/\s+/g, "").slice(-keep)}`;
