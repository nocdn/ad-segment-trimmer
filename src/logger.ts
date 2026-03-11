import { format } from "node:util";

type LogLevel = "INFO" | "WARNING" | "ERROR";

function renderTimestamp(): string {
  const iso = new Date().toISOString();
  return iso.replace("T", " ").replace("Z", "");
}

function log(level: LogLevel, message: string, ...args: unknown[]): void {
  console.log(`${renderTimestamp()} [${level}] ${format(message, ...args)}`);
}

export function logInfo(message: string, ...args: unknown[]): void {
  log("INFO", message, ...args);
}

export function logWarning(message: string, ...args: unknown[]): void {
  log("WARNING", message, ...args);
}

export function logError(message: string, ...args: unknown[]): void {
  log("ERROR", message, ...args);
}
