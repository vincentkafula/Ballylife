/** Database helpers for WhatsApp contacts, conversation state and the message log. */
import { pool } from "../../db/pool";

type Row = Record<string, any>;

export interface Conversation { flow: string | null; step: string | null; data: Record<string, any>; history: string[] }

export async function touchContact(phone: string, profileName: string | null): Promise<Row> {
  const upd = await pool!.query(
    `UPDATE wa_contacts SET profile_name = COALESCE($2, profile_name), last_inbound_at = now(), updated_at = now() WHERE phone = $1 RETURNING *`,
    [phone, profileName]);
  if (upd.rows[0]) return upd.rows[0];
  // A number that already belongs to an account (registered on the website with this phone) is linked straight away.
  const local = phone.startsWith("27") ? `0${phone.slice(2)}` : phone;
  const { rows: users } = await pool!.query(
    `SELECT id FROM users WHERE phone IN ($1, $2, $3) AND account_status <> 'removed' LIMIT 1`, [phone, `+${phone}`, local]);
  const ins = await pool!.query(
    `INSERT INTO wa_contacts (phone, profile_name, user_id, last_inbound_at) VALUES ($1, $2, $3, now()) RETURNING *`,
    [phone, profileName, users[0]?.id ?? null]);
  return ins.rows[0];
}

export async function getContact(phone: string): Promise<Row | null> {
  return (await pool!.query(`SELECT * FROM wa_contacts WHERE phone = $1`, [phone])).rows[0] ?? null;
}

export async function updateContact(phone: string, fields: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  await pool!.query(
    `UPDATE wa_contacts SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE phone = $1`,
    [phone, ...keys.map(k => fields[k])]);
}

const parse = (v: unknown, d: any) => (typeof v === "string" ? JSON.parse(v) : (v ?? d));

export async function loadConversation(phone: string): Promise<Conversation> {
  const r = (await pool!.query(`SELECT * FROM wa_conversations WHERE phone = $1`, [phone])).rows[0];
  return r ? { flow: r.flow, step: r.step, data: parse(r.data, {}), history: parse(r.history, []) } : { flow: null, step: null, data: {}, history: [] };
}

export async function saveConversation(phone: string, c: Conversation): Promise<void> {
  const params = [phone, c.flow, c.step, JSON.stringify(c.data), JSON.stringify(c.history)];
  const upd = await pool!.query(`UPDATE wa_conversations SET flow = $2, step = $3, data = $4, history = $5, updated_at = now() WHERE phone = $1`, params);
  if (!upd.rowCount) await pool!.query(`INSERT INTO wa_conversations (phone, flow, step, data, history) VALUES ($1, $2, $3, $4, $5)`, params);
}

/** Records an inbound message; false when WhatsApp re-delivered one we already have. */
export async function recordInbound(wamid: string, phone: string, kind: string): Promise<boolean> {
  const existing = await pool!.query(`SELECT 1 FROM wa_messages WHERE wamid = $1`, [wamid]);
  if (existing.rows.length) return false;
  await pool!.query(`INSERT INTO wa_messages (wamid, phone, direction, kind) VALUES ($1, $2, 'in', $3)`, [wamid, phone, kind]);
  return true;
}

export async function setInboundBody(wamid: string, body: string): Promise<void> {
  await pool!.query(`UPDATE wa_messages SET body = $2 WHERE wamid = $1`, [wamid, body.slice(0, 4000)]);
}

export async function recordStatus(wamid: string, status: string, error: string | null): Promise<void> {
  await pool!.query(`UPDATE wa_messages SET status = $2, error = COALESCE($3, error) WHERE wamid = $1`, [wamid, status, error]);
}
