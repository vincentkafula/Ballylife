/**
 * Manager departments (e.g. Customer Service, Legal, Partnerships).
 *
 * The super admin creates departments, chooses which @ballylife.com
 * addresses each one handles, and adds managers to them. In the email
 * inbox a manager sees, replies from and sends from only their
 * departments' addresses; the super admin uses every address.
 *
 * Until the first department exists, managers keep full inbox access, so
 * nobody is locked out while departments are being set up.
 */
import { pool } from "../db/pool";
import { logger } from "../utils/logger";
import { writeAudit } from "./superAdmin";

export class DepartmentError extends Error { constructor(message: string, readonly status = 400) { super(message); } }

const DOMAIN = (process.env.INBOX_DOMAIN?.trim() || "ballylife.com").toLowerCase();
const ADDRESS_RE = new RegExp(`^[a-z0-9._+-]+@${DOMAIN.replace(/\./g, "\\.")}$`);

export interface Department { id: string; name: string; mailboxes: string[]; members: { id: string; name: string; username: string; email: string }[] }

function cleanMailboxes(input: unknown): string[] {
  if (!Array.isArray(input)) throw new DepartmentError("mailboxes must be a list of addresses.");
  const out = [...new Set(input.map(a => String(a ?? "").trim().toLowerCase()).filter(Boolean))];
  const bad = out.find(a => !ADDRESS_RE.test(a));
  if (bad) throw new DepartmentError(`${bad} isn't an @${DOMAIN} address.`);
  return out;
}
function cleanName(input: unknown): string {
  const name = String(input ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 60) throw new DepartmentError("Give the department a name (2–60 characters).");
  return name;
}

export async function listDepartments(): Promise<Department[]> {
  const { rows } = await pool!.query(`SELECT * FROM mkt_departments ORDER BY name`);
  const { rows: members } = await pool!.query(
    `SELECT m.department_id, u.id, u.name, u.username, u.email FROM mkt_department_members m JOIN users u ON u.id::text = m.user_id ORDER BY u.name`);
  return rows.map((d: any) => ({
    id: d.id, name: d.name, mailboxes: Array.isArray(d.mailboxes) ? d.mailboxes : [],
    members: members.filter((m: any) => m.department_id === d.id).map((m: any) => ({ id: String(m.id), name: m.name, username: m.username, email: m.email })),
  }));
}

export async function createDepartment(input: { name?: unknown; mailboxes?: unknown }, actor: { userId: string; role: string }): Promise<Department> {
  const name = cleanName(input.name);
  const mailboxes = cleanMailboxes(input.mailboxes ?? []);
  const { rows: dup } = await pool!.query(`SELECT 1 FROM mkt_departments WHERE LOWER(name) = $1`, [name.toLowerCase()]);
  if (dup.length) throw new DepartmentError("A department with that name already exists.", 409);
  const { rows } = await pool!.query(`INSERT INTO mkt_departments (name, mailboxes) VALUES ($1, $2) RETURNING id`, [name, JSON.stringify(mailboxes)]);
  await writeAudit(actor.userId, actor.role, "department", rows[0].id, "department_created", null, { name, mailboxes });
  logger.info("department.created", { name, mailboxes: mailboxes.length });
  return (await listDepartments()).find(d => d.id === rows[0].id)!;
}

export async function updateDepartment(id: string, input: { name?: unknown; mailboxes?: unknown; memberIds?: unknown }, actor: { userId: string; role: string }): Promise<Department> {
  const before = (await listDepartments()).find(d => d.id === id);
  if (!before) throw new DepartmentError("Department not found", 404);
  if (input.name !== undefined) {
    const name = cleanName(input.name);
    const { rows: dup } = await pool!.query(`SELECT id FROM mkt_departments WHERE LOWER(name) = $1`, [name.toLowerCase()]);
    if (dup.some((r: { id: string }) => r.id !== id)) throw new DepartmentError("A department with that name already exists.", 409);
    await pool!.query(`UPDATE mkt_departments SET name = $2 WHERE id = $1`, [id, name]);
  }
  if (input.mailboxes !== undefined) await pool!.query(`UPDATE mkt_departments SET mailboxes = $2 WHERE id = $1`, [id, JSON.stringify(cleanMailboxes(input.mailboxes))]);
  if (input.memberIds !== undefined) {
    if (!Array.isArray(input.memberIds)) throw new DepartmentError("memberIds must be a list.");
    const ids = [...new Set(input.memberIds.map(String))];
    if (ids.length) {
      const { rows } = await pool!.query(`SELECT id FROM users WHERE id::text IN (${ids.map((_, i) => `$${i + 1}`).join(",")}) AND role = 'marketplace_admin' AND account_status <> 'removed'`, ids);
      if (rows.length !== ids.length) throw new DepartmentError("Only active managers can be added to a department.");
    }
    await pool!.query(`DELETE FROM mkt_department_members WHERE department_id = $1`, [id]);
    for (const userId of ids) await pool!.query(`INSERT INTO mkt_department_members (department_id, user_id) VALUES ($1, $2)`, [id, userId]);
  }
  const after = (await listDepartments()).find(d => d.id === id)!;
  await writeAudit(actor.userId, actor.role, "department", id, "department_updated",
    { name: before.name, mailboxes: before.mailboxes, members: before.members.map(m => m.id) },
    { name: after.name, mailboxes: after.mailboxes, members: after.members.map(m => m.id) });
  return after;
}

export async function deleteDepartment(id: string, actor: { userId: string; role: string }): Promise<void> {
  const before = (await listDepartments()).find(d => d.id === id);
  if (!before) throw new DepartmentError("Department not found", 404);
  await pool!.query(`DELETE FROM mkt_department_members WHERE department_id = $1`, [id]);
  await pool!.query(`DELETE FROM mkt_departments WHERE id = $1`, [id]);
  await writeAudit(actor.userId, actor.role, "department", id, "department_deleted", { name: before.name, mailboxes: before.mailboxes }, null);
}

/** Which inbox addresses this signed-in user may read, reply from and send from. */
export interface MailboxAccess { all: boolean; mailboxes: string[]; departments: string[] }

export async function mailboxAccess(user: { userId: string; role: string }): Promise<MailboxAccess> {
  if (user.role === "super_admin") return { all: true, mailboxes: [], departments: [] };
  const { rows: any } = await pool!.query(`SELECT COUNT(*)::int AS n FROM mkt_departments`);
  if (Number(any[0]?.n ?? 0) === 0) return { all: true, mailboxes: [], departments: [] }; // no departments yet: unchanged access
  const { rows } = await pool!.query(
    `SELECT d.name, d.mailboxes FROM mkt_departments d JOIN mkt_department_members m ON m.department_id = d.id WHERE m.user_id = $1`, [user.userId]);
  const mailboxes = [...new Set(rows.flatMap((r: { mailboxes: unknown }) => (Array.isArray(r.mailboxes) ? r.mailboxes : []) as string[]))];
  return { all: false, mailboxes, departments: rows.map((r: { name: string }) => r.name) };
}

export const canUseMailbox = (access: MailboxAccess, mailbox: string) => access.all || access.mailboxes.includes(mailbox.toLowerCase());
