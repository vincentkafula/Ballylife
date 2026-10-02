import { describe, it, expect, vi, afterEach } from "vitest";
import { sendEmail, isEmailConfigured } from "./emailService";

afterEach(() => { vi.unstubAllGlobals(); delete process.env.RESEND_API_KEY; });

describe("email via Resend", () => {
  it("isn't configured without a key, and only logs", async () => {
    expect(isEmailConfigured()).toBe(false);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await sendEmail({ to: "a@example.com", subject: "Hi", html: "<p>Hi</p>" })).toEqual({ sent: false, error: "Email is not configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends through Resend's API with the key from the environment", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ id: "email_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(isEmailConfigured()).toBe(true);
    expect(await sendEmail({ to: "buyer@example.com", subject: "Order confirmed", html: "<p>Thanks <b>Mwila</b></p>" })).toEqual({ sent: true });
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test_key");
    expect(JSON.parse(String(init.body))).toMatchObject({ to: ["buyer@example.com"], subject: "Order confirmed", text: "Thanks Mwila" });
  });

  it("reports Resend's refusal (e.g. domain not verified) instead of claiming it sent", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ name: "validation_error", message: "The ballylife.com domain is not verified." }), { status: 403 })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendEmail({ to: "a@example.com", subject: "x", html: "x" })).toEqual({ sent: false, error: "The ballylife.com domain is not verified." });
  });
});
