import crypto from "crypto";
import { pool } from "../db/pool";
import { sendVerificationEmail } from "./emailService";
import { sendVerificationOtp, isSmsConfigured } from "./smsService";

/**
 * Extracted from authRouter.ts's original /register route so seller
 * registration (marketplaceRouter.ts's /sellers/register) can go
 * through the exact same real verification customer accounts already
 * get, rather than the identity-check toggle SellerApplicationWizard.tsx
 * used to just simulate. One implementation, not two that could drift
 * out of sync with each other.
 */

// Phone verification is only required when SMS is actually configured
// -- otherwise every signup with a phone number would be permanently
// stuck below active waiting on a step that can never complete. The
// moment real Twilio credentials exist, this starts requiring it for
// real, for every signup from then on; already-active accounts aren't
// retroactively downgraded.
export function computeAccountStatus(emailVerified: boolean, phoneVerified: boolean, hasPhone: boolean): "unverified" | "partially_verified" | "active" {
  const phoneRequirementMet = !hasPhone || !isSmsConfigured() || phoneVerified;
  if (emailVerified && phoneRequirementMet) return "active";
  if (emailVerified || phoneVerified) return "partially_verified";
  return "unverified";
}

export async function sendEmailVerification(userId: string, email: string): Promise<void> {
  const emailToken = crypto.randomBytes(32).toString("hex");
  const emailTokenHash = crypto.createHash("sha256").update(emailToken).digest("hex");
  await pool!.query(
    `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '30 minutes')`,
    [userId, emailTokenHash]
  );
  const verifyUrl = `${process.env.MARKETPLACE_PUBLIC_URL ?? ""}/?verifyEmailToken=${emailToken}`;
  await sendVerificationEmail(email, verifyUrl);
}

export async function sendPhoneVerification(userId: string, phone: string): Promise<void> {
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
  await pool!.query(
    `INSERT INTO phone_verification_codes (user_id, code_hash, expires_at) VALUES ($1, $2, now() + interval '10 minutes')`,
    [userId, otpHash]
  );
  await sendVerificationOtp(phone, otp);
}
