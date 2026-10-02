/**
 * The WhatsApp conversation engine.
 *
 * Each phone number has a saved state (wa_conversations): which flow it's
 * in (customer / seller / question), which step, the answers so far, and
 * the steps it came through (for "back"). Every incoming message is:
 *   1. checked for commands that work anywhere (menu, back, edit, cancel,
 *      continue, help, STOP, START),
 *   2. otherwise given to the current step, which validates it and either
 *      asks again or moves on,
 *   3. or, outside a flow, answered with the main menu.
 * Messages from one number are handled one at a time, in order.
 */
import { pool } from "../../db/pool";
import { logger } from "../../utils/logger";
import { sendText, sendButtons, sendList } from "./client";
import { touchContact, updateContact, loadConversation, saveConversation, setInboundBody, type Conversation } from "./store";
import { customerFlow } from "./flows/customer";
import { resetToTemporaryPassword, sendLoginDetails } from "./loginDetails";
import { sellerFlow } from "./flows/seller";
import { questionFlow, humanFlow } from "./flows/question";
import { answerQuestion, isAssistantConfigured } from "./assistant";
import { endHandoff, startHandoff } from "./handoff";
import { askDeals, dealsOptIn, dealsOptOut } from "./deals";
import { detailsFlow } from "./flows/details";
import { shopFlow } from "./flows/shop";
import { sellerProductsFlow, addProductFlow, activeSellerFor } from "./flows/sellerTools";
import { sendMyOrders, sendOrderDetail, sendSellerOrders } from "./orders";
import { cjOnlyCatalog } from "../../utils/catalogPolicy";
import { deleteDocument } from "../documentStore";
import type { Ctx, Flow, Input, Step } from "./types";

const FLOWS: Record<string, Flow> = {
  customer: customerFlow, seller: sellerFlow, question: questionFlow, human: humanFlow, details: detailsFlow,
  shop: shopFlow, seller_products: sellerProductsFlow, add_product: addProductFlow,
};
/** Flows you can jump out of with "shop" / "orders" (browsing, not filling in a form). */
const NAV_FLOWS = new Set([null, "shop", "seller_products", "details"]);
const EDIT_STEP = "__edit";
const SITE = () => (process.env.MARKETPLACE_PUBLIC_URL || "https://www.ballylife.com").replace(/\/$/, "");

const HELP =
  "You can type these any time:\n" +
  "• *menu* — main menu\n• *back* — previous question\n• *edit* — change an answer\n" +
  "• *cancel* — stop and delete your answers\n• *continue* — carry on where you left off\n" +
  "• *shop* — search products\n• *orders* — track your orders\n• *my details* — change your address or email\n" +
  "• *login* — your username for the website\n• *new password* — get a new website password\n" +
  "• *deals* — get new arrivals on WhatsApp (*stop deals* to stop)\n• *STOP* — stop receiving messages";

// ---------------------------------------------------------------- helpers

const emptyConversation = (): Conversation => ({ flow: null, step: null, data: {}, history: [] });

function nextStep(flow: Flow, afterId: string, data: Record<string, any>): Step | undefined {
  const i = flow.steps.findIndex(s => s.id === afterId);
  return flow.steps.slice(i + 1).find(s => !s.skip?.(data));
}

/** Deletes uploaded documents of an application that won't be submitted. */
async function discardUploads(data: Record<string, any>): Promise<void> {
  const keys = [
    ...Object.values((data.docs ?? {}) as Record<string, { key: string }>).map(d => d.key),
    ...((data.photoIds ?? []) as string[]).map(id => `product-photos/${id}`),
  ];
  for (const key of keys) await deleteDocument(key).catch(err => logger.warn("whatsapp.doc_delete_failed", { error: String(err) }));
}

async function firstName(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { rows } = await pool!.query(`SELECT name, role FROM users WHERE id = $1 AND account_status <> 'removed'`, [userId]);
  return rows[0] ? String(rows[0].name).split(" ")[0] : null;
}

export async function sendMainMenu(ctx: Ctx, paused: boolean): Promise<void> {
  const name = await firstName(ctx.userId);
  if (name) {
    const seller = await activeSellerFor(ctx.userId);
    const cont = paused ? [{ id: "menu:continue", title: "↩️ Continue", description: "Pick up where you left off" }] : [];
    const sellerRows = seller?.status === "active" ? [
      { id: "menu:store_orders", title: "🧾 Store orders", description: `Latest orders for ${seller.storeName}` },
      { id: "menu:products", title: "🏷️ My products", description: "Update stock, pause or make live" },
      { id: "menu:add_product", title: "➕ Add a product", description: "Submit a new product for approval" },
    ] : [];
    const pending = seller && seller.status === "pending_kyc" ? "\n\n⏳ Your seller application is being reviewed — we'll message you here." : "";
    await sendList(ctx.phone, `👋 Welcome back, *${name}*! What would you like to do?${pending}`, "Options", [{
      rows: [
        ...cont,
        ...sellerRows,
        { id: "menu:shop", title: "🛍️ Shop products", description: "Search Ballylife" },
        { id: "menu:orders", title: "📦 My orders", description: "Track your orders" },
        { id: "menu:signin", title: "🔐 Website login", description: seller?.status === "active" ? "Username, password, seller dashboard" : "Username and password for ballylife.com" },
        { id: "menu:question", title: "❓ Ask a question", description: "Delivery, returns, products…" },
        { id: "menu:human", title: "👩‍💼 Talk to a person", description: "Our team replies here" },
        { id: "menu:details", title: "👤 My details", description: "Change your address or email" },
        { id: "menu:deals", title: "🔔 Deals on WhatsApp", description: "New arrivals, at most every few days" },
      ].slice(0, 10),
    }]);
    return;
  }
  await sendButtons(ctx.phone,
    "👋 Welcome to *Ballylife* — South Africa's online marketplace, with delivery included on every order.\n\nAre you here to shop or to sell? (Just browsing? Type *shop* to search products.)",
    [{ id: "menu:customer", title: "🛍️ I'm a customer" }, { id: "menu:seller", title: "🏪 I want to sell" }, { id: "menu:question", title: "❓ Just a question" }]);
  if (paused) await sendText(ctx.phone, "You have an unfinished registration — type *continue* to pick up where you left off.");
}

async function startFlow(ctx: Ctx, conv: Conversation, flowId: string): Promise<void> {
  const flow = FLOWS[flowId];
  const first = flow.steps.find(s => !s.skip?.({}))!;
  if (conv.data.paused) await discardUploads(conv.data.paused.data ?? {});
  Object.assign(conv, { flow: flowId, step: first.id, data: {}, history: [] });
  ctx.data = conv.data;
  await saveConversation(ctx.phone, conv);
  await first.ask(ctx);
}

async function askCurrent(ctx: Ctx, conv: Conversation): Promise<void> {
  const step = FLOWS[conv.flow!]?.steps.find(s => s.id === conv.step);
  if (step) await step.ask(ctx);
}

// ---------------------------------------------------------------- commands

type Command = "menu" | "back" | "edit" | "cancel" | "continue" | "help" | "stop" | "start" | "shop" | "orders" | "store_orders" | "deals" | "stop_deals" | "details" | "login" | "new_password";
const NAV_COMMANDS = new Set<Command>(["shop", "orders", "store_orders", "deals", "details"]);
const COMMANDS: Record<string, Command> = {
  menu: "menu", "main menu": "menu", hi: "menu", hello: "menu", hey: "menu",
  back: "back", edit: "edit", cancel: "cancel", continue: "continue", resume: "continue",
  help: "help", stop: "stop", unsubscribe: "stop", start: "start", subscribe: "start",
  shop: "shop", search: "shop", orders: "orders", "my orders": "orders", "track order": "orders", "store orders": "store_orders",
  deals: "deals", "stop deals": "stop_deals", "my details": "details", details: "details",
  login: "login", "log in": "login", "sign in": "login", "login details": "login", username: "login", "my username": "login",
  "new password": "new_password", "reset password": "new_password", "forgot password": "new_password",
};

function commandOf(input: Input, inFlow: boolean, flow: string | null = null): Command | null {
  if (input.kind === "choice" && (input.id === "edit" || input.id === "cancel")) return input.id;
  if (input.kind !== "text") return null;
  const cmd = COMMANDS[input.text.trim().toLowerCase().replace(/[.!]+$/, "")];
  // "shop"/"orders" while filling in a form is probably an answer, not a command.
  if (cmd && NAV_COMMANDS.has(cmd) && !NAV_FLOWS.has(flow)) return null;
  // A greeting in the middle of a flow is probably an answer-less "hi" -- treat it as menu only outside flows.
  if (cmd === "menu" && inFlow && input.text.trim().toLowerCase() !== "menu" && input.text.trim().toLowerCase() !== "main menu") return null;
  return cmd ?? null;
}

async function runCommand(cmd: Command, ctx: Ctx, conv: Conversation): Promise<void> {
  const flow = conv.flow ? FLOWS[conv.flow] : null;
  switch (cmd) {
    case "help":
      await sendText(ctx.phone, HELP);
      return;
    case "shop":
      await startFlow(ctx, conv, "shop");
      return;
    case "deals":
      await askDeals(ctx.phone);
      return;
    case "stop_deals":
      await dealsOptOut(ctx.phone);
      return;
    case "details":
      await handleMenuChoice("menu:details", ctx, conv);
      return;
    case "login":
      await handleMenuChoice("menu:signin", ctx, conv);
      return;
    case "new_password": {
      if (!ctx.userId) { await sendText(ctx.phone, "You don't have a Ballylife account on this number yet. Type *menu* and choose *I'm a customer* to create one."); return; }
      const password = await resetToTemporaryPassword(ctx.userId);
      if (!password) { await sendText(ctx.phone, "We can't reset this account's password on WhatsApp. Use *Forgot password* on the website sign-in page."); return; }
      await sendLoginDetails(ctx.phone, ctx.userId, "Here's a new password. Your old one no longer works, and you've been signed out on other devices.", password);
      return;
    }
    case "orders":
    case "store_orders":
      if (flow) { await saveConversation(ctx.phone, emptyConversation()); conv.flow = null; }
      await handleMenuChoice(cmd === "orders" ? "menu:orders" : "menu:store_orders", ctx, conv);
      return;
    case "menu": {
      if (flow) {
        conv.data = { paused: { flow: conv.flow, step: conv.step, data: conv.data, history: conv.history } };
        conv.flow = null; conv.step = null; conv.history = [];
        await saveConversation(ctx.phone, conv);
      }
      await sendMainMenu(ctx, Boolean(conv.data.paused));
      return;
    }
    case "continue": {
      const p = conv.data.paused;
      if (!p) { await sendText(ctx.phone, "There's nothing to continue. Type *menu* to see your options."); return; }
      Object.assign(conv, { flow: p.flow, step: p.step, data: p.data, history: p.history });
      ctx.data = conv.data;
      await saveConversation(ctx.phone, conv);
      await askCurrent(ctx, conv);
      return;
    }
    case "cancel": {
      await discardUploads(conv.data);
      if (conv.data.paused) await discardUploads(conv.data.paused.data ?? {});
      await saveConversation(ctx.phone, emptyConversation());
      await sendText(ctx.phone, flow || conv.data.paused ? "Cancelled — your answers have been deleted." : "Nothing to cancel.");
      await sendMainMenu(ctx, false);
      return;
    }
    case "back": {
      if (!flow) { await sendMainMenu(ctx, Boolean(conv.data.paused)); return; }
      const prev = conv.history.pop();
      if (!prev) { await sendText(ctx.phone, "You're at the first question."); await askCurrent(ctx, conv); return; }
      conv.step = prev;
      delete conv.data._returnStep;
      await saveConversation(ctx.phone, conv);
      await askCurrent(ctx, conv);
      return;
    }
    case "edit": {
      if (!flow) { await sendText(ctx.phone, "There's nothing to edit right now. Type *menu* to see your options."); return; }
      const current = conv.step === EDIT_STEP ? conv.data._returnStep : conv.step;
      const idx = flow.steps.findIndex(s => s.id === current);
      const editable = flow.steps.slice(0, idx).filter(s => s.label && !s.skip?.(conv.data));
      if (!editable.length) { await sendText(ctx.phone, "Nothing to edit yet — just answer the question above."); return; }
      conv.data._returnStep = current;
      conv.step = EDIT_STEP;
      await saveConversation(ctx.phone, conv);
      await sendList(ctx.phone, "Which answer would you like to change?", "Choose", [{ rows: editable.map(s => ({ id: `edit:${s.id}`, title: s.label! })) }]);
      return;
    }
    case "stop": {
      await discardUploads(conv.data);
      await saveConversation(ctx.phone, emptyConversation());
      await updateContact(ctx.phone, { opted_out: true, opted_out_at: new Date().toISOString() });
      await sendText(ctx.phone, "You've been unsubscribed from Ballylife WhatsApp messages. Reply *START* to subscribe again.");
      return;
    }
    case "start": {
      await updateContact(ctx.phone, { opted_out: false, opted_out_at: null });
      await sendText(ctx.phone, "Welcome back — you're subscribed to Ballylife messages again.");
      await sendMainMenu(ctx, Boolean(conv.data.paused));
      return;
    }
  }
}

// ---------------------------------------------------------------- menu choices

async function handleMenuChoice(id: string, ctx: Ctx, conv: Conversation): Promise<boolean> {
  switch (id) {
    case "menu:customer": await startFlow(ctx, conv, "customer"); return true;
    case "menu:seller": await startFlow(ctx, conv, "seller"); return true;
    case "menu:question": await startFlow(ctx, conv, "question"); return true;
    case "menu:human": await startFlow(ctx, conv, "human"); return true;
    case "menu:deals": await askDeals(ctx.phone); return true;
    case "deals:yes": await dealsOptIn(ctx.phone); return true;
    case "deals:no": await sendText(ctx.phone, "No problem — you won't get deals messages. Type *menu* for other options."); return true;
    case "menu:details":
      if (ctx.userId) await startFlow(ctx, conv, "details");
      else await sendText(ctx.phone, "You don't have a Ballylife account on this number yet. Type *menu* and choose *I'm a customer* to create one.");
      return true;
    case "menu:continue": await runCommand("continue", ctx, conv); return true;
    case "menu:shop": await startFlow(ctx, conv, "shop"); return true;
    case "menu:orders":
      if (ctx.userId) await sendMyOrders(ctx.phone, ctx.userId);
      else await sendText(ctx.phone, `To track orders here, connect your account: tap *I'm a customer* and use the email you shop with. You can also track orders at ${SITE()}/track-order`);
      return true;
    case "menu:store_orders":
    case "menu:products":
    case "menu:add_product": {
      const seller = await activeSellerFor(ctx.userId);
      if (seller?.status !== "active") { await sendText(ctx.phone, "Seller tools are for approved Ballylife sellers. Type *menu* to see your options."); return true; }
      if (id === "menu:store_orders") await sendSellerOrders(ctx.phone, seller.id);
      else if (id === "menu:products") await startFlow(ctx, conv, "seller_products");
      else if (cjOnlyCatalog()) await sendText(ctx.phone, "Adding your own products is paused on Ballylife right now — we'll let you know when it opens again. You can still update stock in *My products*.");
      else await startFlow(ctx, conv, "add_product");
      return true;
    }
    case "menu:signin":
      if (ctx.userId) await sendLoginDetails(ctx.phone, ctx.userId, "Here are your login details.");
      else await sendMainMenu(ctx, false);
      return true;
  }
  if (id.startsWith("order:") && ctx.userId) { await sendOrderDetail(ctx.phone, ctx.userId, id.slice(6)); return true; }
  return false;
}

// ---------------------------------------------------------------- the step machine

async function runStep(input: Input, ctx: Ctx, conv: Conversation): Promise<void> {
  const flow = FLOWS[conv.flow!];

  // Picking which answer to edit.
  if (conv.step === EDIT_STEP) {
    const target = input.kind === "choice" && input.id.startsWith("edit:") ? flow.steps.find(s => s.id === input.id.slice(5)) : undefined;
    if (!target) { await sendText(ctx.phone, "Please pick an answer from the list, or type *back*."); return; }
    for (const k of target.resetOnEdit ?? []) delete conv.data[k];
    conv.step = target.id;
    await saveConversation(ctx.phone, conv);
    await target.ask(ctx);
    return;
  }

  const step = flow.steps.find(s => s.id === conv.step);
  if (!step) { await saveConversation(ctx.phone, emptyConversation()); await sendMainMenu(ctx, false); return; }

  const result = await step.handle(input, ctx);
  if (!result.ok) {
    await sendText(ctx.phone, result.retry);
    if (result.reask) await step.ask(ctx);
    return;
  }
  if (result.startFlow) {
    Object.assign(conv.data, result.set ?? {});
    await startFlow(ctx, conv, result.startFlow);
    return;
  }
  if (result.done) {
    await saveConversation(ctx.phone, emptyConversation());
    return;
  }
  if (result.cancel) {
    await discardUploads({ ...conv.data, ...(result.set ?? {}) });
    await saveConversation(ctx.phone, emptyConversation());
    await sendText(ctx.phone, result.cancel);
    return;
  }
  Object.assign(conv.data, result.set ?? {});
  ctx.data = conv.data;

  if (result.finish) {
    await flow.finish(ctx);
    await saveConversation(ctx.phone, emptyConversation());
    return;
  }

  let target: Step | undefined;
  if (result.next) target = flow.steps.find(s => s.id === result.next);
  else {
    const natural = nextStep(flow, step.id, conv.data);
    const returnTo = conv.data._returnStep as string | undefined;
    if (returnTo && !(natural?.continues)) {
      // Finished editing: back to where they were (usually the review).
      target = flow.steps.find(s => s.id === returnTo);
      delete conv.data._returnStep;
    } else target = natural;
  }
  if (!target) { await flow.finish(ctx); await saveConversation(ctx.phone, emptyConversation()); return; }
  if (target.id !== step.id) conv.history.push(step.id);
  conv.step = target.id;
  await saveConversation(ctx.phone, conv);
  await target.ask(ctx);
}

// ---------------------------------------------------------------- entry point

function describeInput(input: Input): string {
  switch (input.kind) {
    case "text": return input.text;
    case "choice": return `[${input.title}]`;
    case "media": return `[${input.mimeType.startsWith("image/") ? "photo" : "file"}${input.caption ? `: ${input.caption}` : ""}]`;
    case "location": return `[location ${input.lat.toFixed(4)},${input.lng.toFixed(4)}]`;
    default: return `[${input.type}]`;
  }
}

const queues = new Map<string, Promise<void>>();
const recent = new Map<string, number[]>();
const FLOOD_PER_MINUTE = Number(process.env.WHATSAPP_FLOOD_PER_MINUTE ?? 30);

/** Handles one incoming message; messages from the same number run in order. */
export function handleIncoming(msg: { phone: string; profileName: string | null; wamid: string; input: Input }): Promise<void> {
  const times = (recent.get(msg.phone) ?? []).filter(t => Date.now() - t < 60_000);
  times.push(Date.now());
  recent.set(msg.phone, times);
  if (times.length > FLOOD_PER_MINUTE) { logger.warn("whatsapp.flood_ignored", { phoneTail: msg.phone.slice(-4) }); return Promise.resolve(); }

  const prev = queues.get(msg.phone) ?? Promise.resolve();
  const run = prev.then(() => handleOne(msg)).catch(err => logger.error("whatsapp.handle_failed", { error: err instanceof Error ? err.message : String(err) }));
  queues.set(msg.phone, run);
  void run.finally(() => { if (queues.get(msg.phone) === run) queues.delete(msg.phone); });
  return run;
}

async function handleOne({ phone, profileName, wamid, input }: { phone: string; profileName: string | null; wamid: string; input: Input }): Promise<void> {
  const contact = await touchContact(phone, profileName);
  const conv = await loadConversation(phone);
  const ctx: Ctx = { phone, profileName, userId: contact.user_id ? String(contact.user_id) : null, data: conv.data };

  // Never log bank details or ID numbers.
  const step = conv.flow ? FLOWS[conv.flow]?.steps.find(s => s.id === conv.step) : undefined;
  await setInboundBody(wamid, step?.sensitive && input.kind === "text" ? "[hidden: personal details]" : describeInput(input)).catch(() => undefined);

  const cmd = commandOf(input, Boolean(conv.flow), conv.flow);
  if (contact.opted_out && cmd !== "start") return; // they asked us to stop

  // A person has this chat: stay quiet (the message is in the inbox), unless
  // they ask for the bot back with "menu", or opt out.
  if (contact.handoff && cmd !== "stop" && cmd !== "start" && cmd !== "stop_deals") {
    if (cmd === "menu") {
      await endHandoff(phone, "customer");
      await saveConversation(phone, emptyConversation());
      await sendMainMenu(ctx, false);
    }
    return;
  }

  try {
    if (cmd) { await runCommand(cmd, ctx, conv); return; }
    if (conv.flow && NAV_FLOWS.has(conv.flow) && input.kind === "choice" && (input.id.startsWith("menu:") || input.id.startsWith("order:"))) {
      await saveConversation(ctx.phone, emptyConversation());
      if (await handleMenuChoice(input.id, ctx, emptyConversation())) return;
    }
    if (conv.flow) { await runStep(input, ctx, conv); return; }
    if (input.kind === "choice" && await handleMenuChoice(input.id, ctx, conv)) return;
    if (input.kind === "media") {
      await startHandoff(phone, `Sent a ${input.mimeType.startsWith("image/") ? "photo" : "file"}${input.caption ? `: ${input.caption}` : ""}`, { profileName });
      return;
    }
    if (input.kind === "text" && input.text.trim().length >= 3 && isAssistantConfigured()
        && await answerQuestion(phone, ctx.userId, input.text, { wamid, profileName })) return;
    await sendMainMenu(ctx, Boolean(conv.data.paused));
  } catch (err) {
    logger.error("whatsapp.step_failed", { flow: conv.flow, step: conv.step, error: err instanceof Error ? err.message : String(err) });
    await sendText(phone, "Sorry, something went wrong on our side. Please try again, or type *menu*.");
  }
}
