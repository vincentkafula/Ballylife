/**
 * "Just a question" -> the AI assistant answers (or hands over to a person).
 * "Talk to a person" -> straight to the team (WhatsApp Inbox + alerts).
 * Without an ANTHROPIC_API_KEY, questions go to the team as well.
 */
import { sendText } from "../client";
import { answerQuestion } from "../assistant";
import { startHandoff } from "../handoff";
import type { Flow } from "../types";

export const questionFlow: Flow = {
  id: "question",
  steps: [
    {
      id: "q_text",
      ask: async ctx => { await sendText(ctx.phone, "Sure — type your question in one message. (e.g. *How long does delivery take?* or *Do you have air fryers?*)"); },
      handle: async input => {
        if (input.kind !== "text" || input.text.trim().length < 3) return { ok: false, retry: "Please type your question as a message." };
        return { ok: true, set: { question: input.text.trim().slice(0, 1000) }, finish: true };
      },
    },
  ],
  async finish(ctx) {
    const answered = await answerQuestion(ctx.phone, ctx.userId, String(ctx.data.question), { profileName: ctx.profileName });
    if (!answered) await startHandoff(ctx.phone, String(ctx.data.question), { profileName: ctx.profileName });
  },
};

export const humanFlow: Flow = {
  id: "human",
  steps: [
    {
      id: "h_text",
      ask: async ctx => { await sendText(ctx.phone, "Of course. In one message, what do you need help with? A team member will reply here."); },
      handle: async input => {
        if (input.kind !== "text" || input.text.trim().length < 2) return { ok: false, retry: "Please describe what you need help with." };
        return { ok: true, set: { reason: input.text.trim().slice(0, 1000) }, finish: true };
      },
    },
  ],
  async finish(ctx) {
    await startHandoff(ctx.phone, String(ctx.data.reason), { profileName: ctx.profileName });
  },
};
