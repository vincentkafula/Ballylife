import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { catchAsyncErrors } from "./asyncErrors";

describe("catchAsyncErrors", () => {
  it("turns a failing async route into a 500 instead of crashing the server", async () => {
    const app = express();
    const router = express.Router();
    router.get("/boom", async () => { throw new Error('relation "x" does not exist'); });
    router.get("/ok", async (_req, res) => { res.json({ ok: true }); });
    app.use("/api", router);
    app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(500).json({ success: false }); });
    expect(catchAsyncErrors(app)).toBe(2);
    expect((await request(app).get("/api/boom")).status).toBe(500);
    expect((await request(app).get("/api/ok")).body).toEqual({ ok: true });
  });
});
