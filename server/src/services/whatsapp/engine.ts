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
import { customerFlow, sendSignInLink } from "./flows/customer";
import { sellerFlow } from "./flows/seller";
import { questionFlow } from "./flows/question";
import { deleteDocument } from "../documentStore";
import type { Ctx, Flow, Input, Step } from "./types";

const FLOWS: Record<string, Flow> = { customer: customerFlow, seller: sellerFlow, question: questionFlow };
const EDIT_STEP = "__edit";
const SITE = () => (process.env.MARKETPLACE_PUBLIC_URL || "https://www.ballylife.com").replace(/\/$/, "");

const HELP =
  "You can type these any time:\n" +
  "• *menu* — main menu\n• *back* — previous question\n• *edit* — change an answer\n" +
  "• *cancel* — stop and delete your answers\n• *continue* — carry on where you left off\n• *STOP* — stop receiving messages";

// ---------------------------------------------------------------- helpers

const emptyConversation = (): Conversation => ({ flow: null, step: null, data: {}, history: [] });

function nextStep(flow: Flow, afterId: string, data: Record<string, any>): Step | undefined {
  const i = flow.steps.findIndex(s => s.id === afterId);
  return flow.steps.slice(i + 1).find(s => !s.skip?.(data));
}

/** Deletes uploaded documents of an application that won't be submitted. */
async function discardUploads(data: Record<string, any>): Promise<void> {
  for (const doc of Object.values((data.docs ?? {}) as Record<string, { key: string }>)) {
    await deleteDocument(doc.key).catch(err => logger.warn("whatsapp.doc_delete_failed", { error: String(err) }));
  }
}

async function firstName(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { rows } = await pool!.query(`SELECT name, role FROM users WHERE id = $1 AND account_status <> 'removed'`, [userId]);
  return rows[0] ? String(rows[0].name).split(" ")[0] : null;
}

export async function sendMainMenu(ctx: Ctx, paused: boolean): Promise<void> {
  const name = await firstName(ctx.userId);
  if (name) {
    const { rows } = await pool!.query(`SELECT role FROM users WHERE id = $1`, [ctx.userId]);
    const isSeller = rows[0]?.role === "seller";
    await sendList(ctx.phone, `👋 Welcome back, *${name}*! What would you like to do?`, "Options", [{
      rows: [
        ...(paused ? [{ id: "menu:continue", title: "↩️ Continue", description: "Pick up where you left off" }] : []),
        { id: "menu:shop", title: "🛍️ Shop products", description: "Browse Ballylife" },
        { id: "menu:orders", title: "📦 My orders", description: "Track your orders" },
        { id: "menu:signin", title: "🔐 Sign-in link", description: isSeller ? "Open your seller dashboard" : "Sign in on ballylife.com" },
        { id: "menu:question", title: "💬 Talk to a person", description: "Ask our team a question" },
      ],
    }]);
    return;
  }
  await sendButtons(ctx.phone,
    "👋 Welcome to *Ballylife* — South Africa's online marketplace, with delivery included on every order.\n\nAre you here to shop or to sell?",
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

type Command = "menu" | "back" | "edit" | "cancel" | "continue" | "help" | "stop" | "start";
const COMMANDS: Record<string, Command> = {
  menu: "menu", "main menu": "menu", hi: "menu", hello: "menu", hey: "menu",
  back: "back", edit: "edit", cancel: "cancel", continue: "continue", resume: "continue",
  help: "help", stop: "stop", unsubscribe: "stop", start: "start", subscribe: "start",
};

function commandOf(input: Input, inFlow: boolean): Command | null {
  if (input.kind === "choice" && (input.id === "edit" || input.id === "cancel")) return input.id;
  if (input.kind !== "text") return null;
  const cmd = COMMANDS[input.text.trim().toLowerCase().replace(/[.!]+$/, "")];
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
    case "menu:continue": await runCommand("continue", ctx, conv); return true;
    case "menu:shop": await sendText(ctx.phone, `🛍️ Browse everything on Ballylife — delivery included:\n${SITE()}/catalog`, { previewUrl: true }); return true;
    case "menu:orders": await sendText(ctx.phone, `📦 Your orders and tracking:\n${SITE()}/orders\n\n(Order tracking right here in WhatsApp is coming soon.)`); return true;
    case "menu:signin":
      if (ctx.userId) await sendSignInLink(ctx.phone, ctx.userId, "Here's your sign-in link.");
      else await sendMainMenu(ctx, false);
      return true;
  }
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
    case "media": return `[file ${input.mimeType}]`;
    case "location": return `[location ${input.lat.toFixed(4)},${input.lng.toFixed(4)}]`;
    default: return `[${input.type}]`;
  }
}

const queues = new Map<string, Promise<void>>();
const recent = new Map<string, number[]>();
const FLOOD_PER_MINUTE = 20;

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

  const cmd = commandOf(input, Boolean(conv.flow));
  if (contact.opted_out && cmd !== "start") return; // they asked us to stop

  try {
    if (cmd) { await runCommand(cmd, ctx, conv); return; }
    if (conv.flow) { await runStep(input, ctx, conv); return; }
    if (input.kind === "choice" && await handleMenuChoice(input.id, ctx, conv)) return;
    await sendMainMenu(ctx, Boolean(conv.data.paused));
  } catch (err) {
    logger.error("whatsapp.step_failed", { flow: conv.flow, step: conv.step, error: err instanceof Error ? err.message : String(err) });
    await sendText(phone, "Sorry, something went wrong on our side. Please try again, or type *menu*.");
  }
}
