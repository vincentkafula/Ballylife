/**
 * Private document storage for seller applications (ID, proof of address).
 *
 * Files go to the Railway bucket "ballylife-documents" (S3-compatible,
 * private). Each file is also encrypted by us before upload, so even
 * someone with the bucket keys can't read it; admins only see documents
 * through an authenticated dashboard endpoint that decrypts on the fly.
 *
 * Railway variables (references to the bucket, set automatically):
 *   DOCS_BUCKET, DOCS_ENDPOINT, DOCS_REGION, DOCS_ACCESS_KEY_ID, DOCS_SECRET_ACCESS_KEY
 */
import crypto from "crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { encryptBuffer, decryptBuffer } from "../utils/secureData";

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const ALLOWED_DOCUMENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];

export function isDocumentStoreConfigured(): boolean {
  return ["DOCS_BUCKET", "DOCS_ENDPOINT", "DOCS_ACCESS_KEY_ID", "DOCS_SECRET_ACCESS_KEY"].every(n => process.env[n]?.trim());
}

let client: S3Client | null = null;
function s3(): S3Client {
  if (!isDocumentStoreConfigured()) throw new Error("Document storage isn't configured (DOCS_* variables).");
  client ??= new S3Client({
    endpoint: process.env.DOCS_ENDPOINT!.trim(),
    region: process.env.DOCS_REGION?.trim() || "auto",
    credentials: { accessKeyId: process.env.DOCS_ACCESS_KEY_ID!.trim(), secretAccessKey: process.env.DOCS_SECRET_ACCESS_KEY!.trim() },
  });
  return client;
}
const bucket = () => process.env.DOCS_BUCKET!.trim();

/** Stores an encrypted copy; returns the object key to keep in the database. */
export async function putDocument(prefix: string, body: Buffer, mimeType: string): Promise<string> {
  const key = `${prefix}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.bin`;
  await s3().send(new PutObjectCommand({
    Bucket: bucket(), Key: key, Body: encryptBuffer(body),
    ContentType: "application/octet-stream", Metadata: { "original-type": mimeType },
  }));
  return key;
}

export async function getDocument(key: string): Promise<Buffer> {
  const out = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  const bytes = Buffer.from(await out.Body!.transformToByteArray());
  return decryptBuffer(bytes);
}

/**
 * Product photos sent by sellers on WhatsApp. Unlike ID documents these are
 * public (they appear on the product page), so they are stored unencrypted
 * and served through /api/whatsapp/photos/:id.
 */
export async function putProductPhoto(body: Buffer, mimeType: string): Promise<string> {
  const id = crypto.randomUUID();
  await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: `product-photos/${id}`, Body: body, ContentType: mimeType }));
  return id;
}

export async function getProductPhoto(id: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const out = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: `product-photos/${id}` }));
  return { bytes: Buffer.from(await out.Body!.transformToByteArray()), mimeType: out.ContentType ?? "image/jpeg" };
}

export async function deleteDocument(key: string): Promise<void> {
  await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}
