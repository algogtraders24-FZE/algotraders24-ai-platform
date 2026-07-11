// services/backend/Logger.ts
// Sprint 14A — Backend Foundation
// Structured, level-based logger with timestamps.

import type { LogLevel, LogEntry } from "@/types/backend";
import { LOG_CONFIG } from "@/config/backend.config";

export class Logger {
  private scope: string;

  constructor(scope = "app") {
    this.scope = scope;
  }

  private shouldLog(level: LogLevel): boolean {
    return (
      LOG_CONFIG.levelPriority[level] >=
      LOG_CONFIG.levelPriority[LOG_CONFIG.minLevel]
    );
  }

  private build(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>
  ): LogEntry {
    return {
      level,
      message: "[" + this.scope + "] " + message,
      timestamp: new Date().toISOString(),
      context,
    };
  }

  private emit(entry: LogEntry): void {
    if (!this.shouldLog(entry.level)) return;

    const line = entry.timestamp + " " + entry.level + " " + entry.message;
    switch (entry.level) {
      case "ERROR":
        console.error(line, entry.context ?? "");
        break;
      case "WARN":
        console.warn(line, entry.context ?? "");
        break;
      case "DEBUG":
        console.debug(line, entry.context ?? "");
        break;
      default:
        console.log(line, entry.context ?? "");
    }
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.emit(this.build("INFO", message, context));
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.emit(this.build("WARN", message, context));
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.emit(this.build("ERROR", message, context));
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.emit(this.build("DEBUG", message, context));
  }

  child(scope: string): Logger {
    return new Logger(this.scope + ":" + scope);
  }
}

export const logger = new Logger("backend");
