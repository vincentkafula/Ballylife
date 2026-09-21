import { describe, it, expect, vi, afterEach } from "vitest";
import { logger } from "./logger";

describe("logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("info logs valid JSON with the right shape to console.log", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("something happened", { orderId: "abc123" });
    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("something happened");
    expect(parsed.context).toEqual({ orderId: "abc123" });
    expect(parsed.timestamp).toBeTruthy();
  });

  it("error logs to console.error, not console.log", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.error("something failed");
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("warn logs to console.warn", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.warn("worth noticing");
    expect(spy).toHaveBeenCalledOnce();
  });

  it("omits the context key entirely when no context is passed, rather than logging context: undefined", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("no context here");
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect("context" in parsed).toBe(false);
  });
});
