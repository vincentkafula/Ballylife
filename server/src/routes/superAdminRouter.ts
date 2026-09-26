import { Router, Request, Response } from "express";
import { pool } from "../db/pool";
import { requireAuth, requireSuperAdmin } from "../middleware/auth";
import { logger } from "../utils/logger";
import { createManager, removeAccount, restoreAccount, AccountError } from "../services/superAdmin";

/**
 * Super admin only: managers and account removal. The super admin account
 * itself is defined by SUPER_ADMIN_* Railway variables (services/superAdmin.ts).
 */
const router: ReturnType<typeof Router> = Router();
const superAdmin = [requireAuth, requireSuperAdmin];

const fail = (res: Response, err: unknown, fallback: string) => {
  if (err instanceof AccountError) { res.status(err.status).json({ success: false, error: err.message }); return; }
  logger.error("super_admin.request_failed", { error: err instanceof Error ? err.message : String(err) });
  res.status(500).json({ success: false, error: fallback });
};

const mapUser = (u: Record<string, any>) => ({
  id: u.id, username: u.username, name: u.name, email: u.email, role: u.role, accountStatus: u.account_status,
  lastLogin: u.last_login, createdAt: u.created_at, removedAt: u.removed_at ?? null, removalReason: u.removal_reason ?? null,
});

router.get("/admin/managers", ...superAdmin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const { rows } = await pool!.query(`SELECT * FROM users WHERE role IN ('marketplace_admin', 'super_admin') ORDER BY role DESC, created_at`);
    res.json({ success: true, data: rows.map(mapUser) });
  } catch (err) { fail(res, err, "Couldn't load managers."); }
});

router.post("/admin/managers", ...superAdmin, async (req: Request, res: Response): Promise<void> => {
  try { res.status(201).json({ success: true, data: mapUser(await createManager(req.body ?? {}, req.user!)) }); }
  catch (err) { fail(res, err, "Couldn't create the manager."); }
});

router.post("/admin/users/:id/remove", ...superAdmin, async (req: Request, res: Response): Promise<void> => {
  try { res.json({ success: true, data: mapUser(await removeAccount(req.params.id, req.user!, req.body?.reason)) }); }
  catch (err) { fail(res, err, "Couldn't remove the account."); }
});

router.post("/admin/users/:id/restore", ...superAdmin, async (req: Request, res: Response): Promise<void> => {
  try { res.json({ success: true, data: mapUser(await restoreAccount(req.params.id, req.user!)) }); }
  catch (err) { fail(res, err, "Couldn't restore the account."); }
});

export default router;
