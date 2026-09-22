/**
 * Marketplace's own SMS sender — same discipline as emailService.ts and
 * payfastProcessor.ts: ships functional but inactive until real
 * credentials are set. Calls Twilio's REST API directly via fetch rather
 * than adding their SDK as a dependency — the send-an-SMS call is a
 * single POST with Basic Auth, simple enough not to need it.
 *
 * Required env vars to actually send SMS:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN — from your Twilio console
 *   TWILIO_FROM_NUMBER — a Twilio phone number capable of sending SMS,
 *     in E.164 format (e.g. "+15017122661")
 *
 * Without those, send() logs the message to the console instead of
 * sending it. Critically, phone verification itself is designed to
 * degrade gracefully around this too (see authRouter.ts's
 * computeAccountStatus) -- if SMS isn't configured, phone verification
 * is not required for an account to reach "active" status, rather than
 * every new signup being permanently stuck below active because a
 * required step can never be completed. The moment real Twilio
 * credentials are added, phone verification becomes a real requirement
 * for every signup from then on.
 */

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;

export function isSmsConfigured(): boolean {
  return Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER);
}

export async function sendSms(to: string, body: string): Promise<{ sent: boolean; error?: string }> {
  if (!isSmsConfigured()) {
    console.log(`[sms] Would send "${body}" to ${to} — Twilio not configured, see smsService.ts for required env vars.`);
    return { sent: false, error: "SMS is not configured" };
  }
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64")}`,
      },
      body: new URLSearchParams({ To: to, From: TWILIO_FROM_NUMBER!, Body: body }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      console.error("[sms] Twilio send failed:", res.status, errBody);
      return { sent: false, error: (errBody as { message?: string }).message ?? `Twilio returned ${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.error("[sms] Send failed:", err);
    return { sent: false, error: err instanceof Error ? err.message : "Send failed" };
  }
}

export function sendVerificationOtp(to: string, code: string): Promise<{ sent: boolean; error?: string }> {
  return sendSms(to, `Your Ballylife verification code is ${code}. It expires in 10 minutes.`);
}
