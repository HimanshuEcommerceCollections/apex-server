import { isTest } from "../config/env";

type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, args: unknown[]): void {
  if (isTest) return; // keep test output clean
  const ts = new Date().toISOString();
  const prefix = `[${ts}] ${level.toUpperCase()}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (console[level] as (...a: any[]) => void)(prefix, ...args);
}

/** Leveled console logger (verbatim-spirit port from Elevate). */
export const logger = {
  debug: (...args: unknown[]) => emit("debug", args),
  info: (...args: unknown[]) => emit("info", args),
  warn: (...args: unknown[]) => emit("warn", args),
  error: (...args: unknown[]) => emit("error", args),
};
