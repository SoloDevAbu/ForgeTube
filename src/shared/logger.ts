import fs from "node:fs/promises";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  projectId?: string;
  stage?: string;
  jobId?: string;
  message: string;
  details?: unknown;
}

/**
 * Redacts potential API keys or secrets in logged strings or objects.
 */
export function sanitizeLogData(input: unknown): unknown {
  if (typeof input === "string") {
    return input.replace(/([A-Za-z0-9_-]{20,})/g, (match) => {
      if (match.startsWith("AIza") || match.startsWith("sk-") || match.length > 32) {
        return match.slice(0, 4) + "..." + match.slice(-4);
      }
      return match;
    });
  }
  if (Array.isArray(input)) {
    return input.map(sanitizeLogData);
  }
  if (input !== null && typeof input === "object") {
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (/key|secret|token|password|auth/i.test(k)) {
        res[k] = "[REDACTED]";
      } else {
        res[k] = sanitizeLogData(v);
      }
    }
    return res;
  }
  return input;
}

export class Logger {
  private logFilePath?: string;
  private quietConsole = false;

  constructor(logFilePath?: string, quietConsole = false) {
    this.logFilePath = logFilePath;
    this.quietConsole = quietConsole;
  }

  setLogFile(filePath: string) {
    this.logFilePath = filePath;
  }

  setQuietConsole(quiet: boolean) {
    this.quietConsole = quiet;
  }

  private async appendToFile(entry: LogEntry) {
    if (!this.logFilePath) return;
    try {
      const line = JSON.stringify(entry) + "\n";
      await fs.mkdir(path.dirname(this.logFilePath), { recursive: true });
      await fs.appendFile(this.logFilePath, line, "utf-8");
    } catch {
      // Fail silently for logger file append so app flow is not broken
    }
  }

  private log(level: LogLevel, message: string, meta?: { projectId?: string; stage?: string; jobId?: string; details?: unknown }) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      projectId: meta?.projectId,
      stage: meta?.stage,
      jobId: meta?.jobId,
      message,
      details: sanitizeLogData(meta?.details),
    };

    if (!this.quietConsole) {
      const prefix = `[${entry.timestamp.split("T")[1]?.slice(0, 8)}] [${level.toUpperCase()}]`;
      const context = entry.stage ? ` [${entry.stage}]` : "";
      if (level === "error") {
        console.error(`${prefix}${context} ${message}`, entry.details ? entry.details : "");
      } else if (level === "warn") {
        console.warn(`${prefix}${context} ${message}`);
      } else {
        console.log(`${prefix}${context} ${message}`);
      }
    }

    void this.appendToFile(entry);
  }

  debug(message: string, meta?: { projectId?: string; stage?: string; jobId?: string; details?: unknown }) {
    this.log("debug", message, meta);
  }

  info(message: string, meta?: { projectId?: string; stage?: string; jobId?: string; details?: unknown }) {
    this.log("info", message, meta);
  }

  warn(message: string, meta?: { projectId?: string; stage?: string; jobId?: string; details?: unknown }) {
    this.log("warn", message, meta);
  }

  error(message: string, meta?: { projectId?: string; stage?: string; jobId?: string; details?: unknown }) {
    this.log("error", message, meta);
  }
}

export const defaultLogger = new Logger();

