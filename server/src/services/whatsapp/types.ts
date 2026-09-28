/** Shared shapes for the WhatsApp conversation engine and its flows. */

/** What the user sent, normalised from WhatsApp's message types. */
export type Input =
  | { kind: "text"; text: string }
  | { kind: "choice"; id: string; title: string }           // reply button or list row
  | { kind: "media"; mediaId: string; mimeType: string; filename?: string }
  | { kind: "location"; lat: number; lng: number; address?: string; name?: string }
  | { kind: "other"; type: string };

export interface Ctx {
  phone: string;                  // e.g. 27821234567
  profileName: string | null;     // the name on their WhatsApp profile
  userId: string | null;          // linked Ballylife account, if any
  data: Record<string, any>;      // answers so far in this flow
}

export type StepResult =
  | { ok: true; set?: Record<string, any>; next?: string; finish?: boolean; cancel?: string; startFlow?: string; done?: boolean }
  | { ok: false; retry: string; reask?: boolean };

export interface Step {
  id: string;
  /** Shown in the "edit" list; steps without a label can't be edited directly. */
  label?: string;
  /** Answers here are never written to the message log (bank details). */
  sensitive?: boolean;
  /** Part of the previous step's group: when editing, keep going through it (e.g. the bank details). */
  continues?: boolean;
  /** Answers cleared when this step is edited (e.g. the chosen categories). */
  resetOnEdit?: string[];
  skip?(data: Record<string, any>): boolean;
  ask(ctx: Ctx): Promise<void>;
  handle(input: Input, ctx: Ctx): Promise<StepResult>;
}

export interface Flow {
  id: "customer" | "seller" | "question" | "shop" | "seller_products" | "add_product";
  steps: Step[];
  /** The review/confirm step "edit" returns to. */
  confirmStep?: string;
  finish(ctx: Ctx): Promise<void>;
}

export const CONSENT_VERSION = "2026-09";
