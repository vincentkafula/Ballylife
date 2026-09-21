/**
 * A small structured-logging helper, not a wholesale replacement for
 * console.log everywhere in this codebase -- that would be a much larger
 * retrofit than this phase covers. Applied here to the PayFast webhook
 * handler specifically, since docs/threat-model.md already flags that
 * path as the one where security-relevant log lines matter most (a
 * forged/rejected ITN, a signature mismatch). Genuinely useful for any
 * new call site going forward, and existing plain console.log/error
 * calls elsewhere keep working exactly as before -- nothing here
 * requires touching them.
 *
 * Deliberately not a dependency on a logging library (pino, winston,
 * etc.) -- at this app's current scale, a small JSON-shaped wrapper
 * around console output is proportionate, and it costs nothing to
 * upgrade later once a real log aggregator or APM tool is chosen
 * (see docs/production-readiness.md on why that choice isn't made
 * here). Railway captures stdout/stderr from both services
 * automatically regardless of format; this just makes those lines
 * parseable rather than free text.
 */

type LogContext = Record<string, unknown>;

function emit(level: "info" | "warn" | "error", message: string, context?: LogContext): void {
  const line = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context ? { context } : {}),
  };
  const out = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  out(JSON.stringify(line));
}

export const logger = {
  info: (message: string, context?: LogContext) => emit("info", message, context),
  warn: (message: string, context?: LogContext) => emit("warn", message, context),
  error: (message: string, context?: LogContext) => emit("error", message, context),
};
