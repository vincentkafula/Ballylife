/**
 * WhatsApp account setup from the dashboard:
 *
 *  - Message templates: the exact templates this code sends (names and
 *    placeholders must match), submitted to Meta for review on request, with
 *    their approval status. Meta has to approve a template before it can be
 *    sent outside the 24-hour window.
 *  - Business profile: the "About", description, email, website and address
 *    customers see on Ballylife's WhatsApp number.
 *
 * Uses WHATSAPP_TOKEN (whatsapp_business_management) and WHATSAPP_WABA_ID.
 */
import { WhatsAppError } from "./client";

const GRAPH = () => `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || "v23.0"}`;
const SITE = () => (process.env.MARKETPLACE_PUBLIC_URL || "https://www.ballylife.com").replace(/\/$/, "");
const LANG = () => process.env.WHATSAPP_TEMPLATE_LANG || "en";

async function graph(method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${GRAPH()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN?.trim() ?? ""}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await res.json().catch(() => ({})) as any;
  if (!res.ok || j?.error) throw new WhatsAppError(j?.error?.error_user_msg || j?.error?.message || `HTTP ${res.status}`, j?.error?.code);
  return j;
}

interface TemplateDef { name: string; category: "UTILITY" | "MARKETING"; body: string; examples: string[]; button?: { text: string; url: string; example?: string }; purpose: string }

/** Every template the bot sends. Placeholders ({{1}}…) are filled by the code that sends them. */
export const TEMPLATES: TemplateDef[] = [
  {
    name: "seller_application_approved", category: "UTILITY", purpose: "Seller approved (with sign-in link)",
    body: "Hi {{1}}, good news! Your Ballylife seller application for {{2}} has been approved. Tap below to sign in and set up your store. The link works once and expires in 24 hours.",
    examples: ["Thandi", "Thandi's Crafts"],
    button: { text: "Sign in", url: `${SITE()}/wa-login?t={{1}}`, example: `${SITE()}/wa-login?t=abc123` },
  },
  {
    name: "seller_application_update", category: "UTILITY", purpose: "Seller application needs more (reason)",
    body: "Hi {{1}}, we've reviewed your Ballylife seller application for {{2}}. We can't approve it yet because: {{3}}. Reply to this message and we'll help you complete it.",
    examples: ["Thandi", "Thandi's Crafts", "the proof of address is older than 3 months"],
  },
  {
    name: "order_status_update", category: "UTILITY", purpose: "Order paid / shipped / delivered / cancelled",
    body: "Hi {{1}}, your Ballylife order {{2}} is now {{3}}. {{4}}\n\nThank you for shopping with Ballylife.",
    examples: ["Thandi", "BL-1002", "on its way", "Tracking number: TRK123."],
    button: { text: "My orders", url: `${SITE()}/orders` },
  },
  {
    name: "seller_new_order", category: "UTILITY", purpose: "New order alert for sellers",
    body: "New Ballylife order {{1}}: {{2}} item(s), total {{3}}. Please prepare it for dispatch. Reply STORE ORDERS to see the details.",
    examples: ["BL-1002", "2", "R500"],
  },
  {
    name: "staff_handoff_alert", category: "UTILITY", purpose: "Alert to staff: customer wants a person",
    body: "Customer {{1}} ({{2}}) asked to speak to a person: \"{{3}}\". Open the Ballylife dashboard to reply.",
    examples: ["Thandi", "+27821234567", "My parcel arrived damaged"],
  },
  {
    name: "new_arrival", category: "MARKETING", purpose: "Deals broadcast to subscribers",
    body: "Hi {{1}}, new on Ballylife: {{2}} for {{3}}, delivery included. Tap below to have a look. Reply STOP DEALS to stop these messages.",
    examples: ["Thandi", "Wireless Earbuds Pro", "R349"],
    button: { text: "View product", url: `${SITE()}/product/{{1}}`, example: `${SITE()}/product/1234` },
  },
];

function toMeta(t: TemplateDef) {
  const components: unknown[] = [{ type: "BODY", text: t.body, example: { body_text: [t.examples] } }];
  if (t.button) {
    components.push({ type: "BUTTONS", buttons: [{ type: "URL", text: t.button.text, url: t.button.url, ...(t.button.example ? { example: [t.button.example] } : {}) }] });
  }
  return { name: t.name, language: LANG(), category: t.category, components };
}

/** Our templates and what Meta says about each (approved / pending / rejected / not submitted). */
export async function templateStatus(): Promise<{ name: string; purpose: string; category: string; status: string; reason: string | null }[]> {
  const waba = process.env.WHATSAPP_WABA_ID?.trim();
  if (!waba) throw new Error("WHATSAPP_WABA_ID isn't set.");
  const j = await graph("GET", `/${waba}/message_templates?fields=name,status,category,language,rejected_reason&limit=200`);
  const found = new Map<string, any>(((j.data ?? []) as any[]).filter(t => t.language === LANG()).map(t => [String(t.name), t]));
  return TEMPLATES.map(t => {
    const m = found.get(t.name);
    return { name: t.name, purpose: t.purpose, category: m?.category ?? t.category, status: m ? String(m.status) : "NOT_SUBMITTED", reason: m?.rejected_reason && m.rejected_reason !== "NONE" ? String(m.rejected_reason) : null };
  });
}

/** Submits every template that isn't with Meta yet. Existing ones are left alone. */
export async function submitMissingTemplates(): Promise<{ submitted: string[]; failed: { name: string; error: string }[] }> {
  const waba = process.env.WHATSAPP_WABA_ID?.trim();
  if (!waba) throw new Error("WHATSAPP_WABA_ID isn't set.");
  const status = await templateStatus();
  const out = { submitted: [] as string[], failed: [] as { name: string; error: string }[] };
  for (const s of status.filter(x => x.status === "NOT_SUBMITTED")) {
    const def = TEMPLATES.find(t => t.name === s.name)!;
    try { await graph("POST", `/${waba}/message_templates`, toMeta(def)); out.submitted.push(def.name); }
    catch (err) { out.failed.push({ name: def.name, error: err instanceof Error ? err.message : String(err) }); }
  }
  return out;
}

export const DEFAULT_PROFILE = {
  about: "Shop South Africa's online marketplace. Delivery included.",
  description: "Ballylife is a South African online marketplace — electronics, home, fashion, beauty, toys and more, with delivery included on most items. Chat here to shop, track orders, get help, or apply to sell.",
  email: "",
  websites: ["https://www.ballylife.com"],
  address: "",
};

export async function getBusinessProfile(): Promise<Record<string, any>> {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const j = await graph("GET", `/${id}/whatsapp_business_profile?fields=about,description,email,websites,address,vertical,profile_picture_url`);
  return j.data?.[0] ?? {};
}

export async function updateBusinessProfile(p: { about?: string; description?: string; email?: string; websites?: string[]; address?: string }): Promise<void> {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const body: Record<string, unknown> = { messaging_product: "whatsapp", vertical: "RETAIL" };
  if (p.about !== undefined) body.about = p.about.slice(0, 139);
  if (p.description !== undefined) body.description = p.description.slice(0, 512);
  if (p.email) body.email = p.email.slice(0, 128);
  if (p.address !== undefined && p.address) body.address = p.address.slice(0, 256);
  if (p.websites) body.websites = p.websites.filter(w => /^https?:\/\//.test(w)).slice(0, 2);
  await graph("POST", `/${id}/whatsapp_business_profile`, body);
}
